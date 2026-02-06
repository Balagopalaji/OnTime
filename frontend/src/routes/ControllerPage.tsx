import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Clock3,
  Pause,
  Play,
  RotateCcw,
  Share2,
  SkipBack,
  SkipForward,
  QrCode,
  Wifi,
} from 'lucide-react'
import { useDataContext } from '../context/DataProvider'
import { useAuth } from '../context/AuthContext'
import { RundownPanel } from '../components/controller/RundownPanel'
import { CuesPanel } from '../components/controller/CuesPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { LiveTimerPreview } from '../components/controller/LiveTimerPreview'
import { PresentationStatusPanel } from '../components/controller/PresentationStatusPanel'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { LocalQrCode } from '../components/core/LocalQrCode'
import { Tooltip } from '../components/core/Tooltip'
import { formatDate, formatDuration } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'
import { getCloudViewerUrl } from '../lib/viewer-links'
import { useAppMode } from '../context/AppModeContext'
import { useCompanionConnection } from '../context/CompanionConnectionContext'
import { useClock } from '../hooks/useClock'
import { auth, db } from '../lib/firebase'
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import {
  createLanPairing,
  fetchLanPairingStatus,
  resetLanViewers,
  revokeLanViewer,
  type LanPairingInfo,
  type LanPairingStatus,
} from '../lib/companion-pairing'
import { canPerformControllerAction } from './controller-permissions'
import { resolveControllerJoinIntent } from './controller-join-intent'
import type { LiveCueRecord, ControllerClient, Segment as SegmentType, Timer as TimerType, Cue } from '../types'

type PresentationEntry = {
  key: string
  record: LiveCueRecord
  duplicateCount: number
}

const buildPresentationKey = (record: LiveCueRecord) => {
  const filename = record.cue.metadata?.filename?.trim()
  const slideNumber = record.cue.metadata?.slideNumber
  if (!filename && slideNumber === undefined) return record.cue.id
  return `${filename ?? 'unknown'}::${slideNumber ?? 'unknown'}`
}

const ROOM_CLIENT_IDLE_MS = {
  cloud: 300_000,
  companion: 300_000,
}

const ROOM_CLIENT_MAX_AGE_MS = {
  cloud: 900_000,
  companion: 900_000,
}

const getClientPresenceThresholds = (source?: 'cloud' | 'companion') => {
  if (source === 'cloud') {
    return { idleMs: ROOM_CLIENT_IDLE_MS.cloud, maxAgeMs: ROOM_CLIENT_MAX_AGE_MS.cloud }
  }
  if (source === 'companion') {
    return { idleMs: ROOM_CLIENT_IDLE_MS.companion, maxAgeMs: ROOM_CLIENT_MAX_AGE_MS.companion }
  }
  return { idleMs: ROOM_CLIENT_IDLE_MS.companion, maxAgeMs: ROOM_CLIENT_MAX_AGE_MS.companion }
}

const getClientPresenceState = (
  client: { lastHeartbeat?: number; source?: 'cloud' | 'companion' },
  now: number,
): 'active' | 'idle' | 'stale' => {
  if (typeof client.lastHeartbeat !== 'number') return 'active'
  const { idleMs, maxAgeMs } = getClientPresenceThresholds(client.source)
  const age = now - client.lastHeartbeat
  if (age <= idleMs) return 'active'
  if (age <= maxAgeMs) return 'idle'
  return 'stale'
}

type MergedClientRow = {
  key: string
  displayName: string
  sources: Array<'cloud' | 'companion'>
  lastHeartbeat?: number
  targetClientId: string
  preferredSource: 'cloud' | 'companion'
}

type RoomPinMeta = { value: string | null; updatedAt: number; source: 'cloud' | 'companion' }

const buildClientDisplayName = (client: ControllerClient) => {
  if (client.userName && client.deviceName) return `${client.userName} · ${client.deviceName}`
  return client.userName ?? client.deviceName ?? 'Controller'
}

const mergeClientSourcesForDisplay = (
  clients: ControllerClient[],
  preferredSource?: 'cloud' | 'companion',
): MergedClientRow[] => {
  const grouped = new Map<
    string,
    { clients: ControllerClient[]; sources: Set<'cloud' | 'companion'> }
  >()

  clients.forEach((client) => {
    const deviceKey = client.deviceName?.trim()
    const userKey = client.userId?.trim()
    const groupKey = deviceKey
      ? `device:${deviceKey}`
      : userKey
      ? `user:${userKey}`
      : `client:${client.clientId}`
    const bucket = grouped.get(groupKey) ?? { clients: [], sources: new Set() }
    bucket.clients.push(client)
    if (client.source === 'cloud' || client.source === 'companion') {
      bucket.sources.add(client.source)
    }
    grouped.set(groupKey, bucket)
  })

  return [...grouped.entries()].map(([key, bucket]) => {
    const sources = [...bucket.sources.values()]
    const sorted = [...bucket.clients].sort(
      (a, b) => (b.lastHeartbeat ?? 0) - (a.lastHeartbeat ?? 0),
    )
    const primary = sorted[0]
    const clientIdsBySource: Partial<Record<'cloud' | 'companion', string>> = {}
    bucket.clients.forEach((client) => {
      if (client.source === 'cloud' && !clientIdsBySource.cloud) {
        clientIdsBySource.cloud = client.clientId
      }
      if (client.source === 'companion' && !clientIdsBySource.companion) {
        clientIdsBySource.companion = client.clientId
      }
    })
    const preferred =
      (preferredSource && clientIdsBySource[preferredSource]) ||
      (clientIdsBySource.companion ? 'companion' : clientIdsBySource.cloud ? 'cloud' : undefined)
    const preferredSourceResolved =
      preferred === 'cloud' || preferred === 'companion'
        ? preferred
        : primary.source === 'cloud'
          ? 'cloud'
          : 'companion'
    const lastHeartbeat = bucket.clients.reduce((max, client) => {
      const ts = client.lastHeartbeat ?? 0
      return ts > max ? ts : max
    }, 0)
    const heartbeatValue = lastHeartbeat > 0 ? lastHeartbeat : undefined
    const targetClientId =
      preferredSourceResolved === 'cloud'
        ? clientIdsBySource.cloud ?? primary.clientId
        : clientIdsBySource.companion ?? primary.clientId

    return {
      key,
      displayName: buildClientDisplayName(primary),
      sources,
      lastHeartbeat: heartbeatValue,
      targetClientId,
      preferredSource: preferredSourceResolved,
    }
  })
}

export const ControllerPage = () => {
  const { roomId } = useParams()
  const { effectiveMode } = useAppMode()
  const { user } = useAuth()
  const companion = useCompanionConnection()
  const { handshakeStatus } = companion
  const companionReady = companion.isConnected && handshakeStatus === 'ack'
  const ctx = useDataContext()
  const {
    getRoom,
    getTimers,
    getRoomAuthority,
    startTimer,
    pauseTimer,
    resetTimer,
    nudgeTimer,
    createTimer,
    deleteTimer,
    reorderTimer,
    updateTimer,
    updateRoomMeta,
    resetTimerProgress,
    setActiveTimer,
    setClockMode,
    setClockFormat,
    updateMessage,
    roomClients,
    controlDisplacements,
    controlErrors,
    controlRequests,
    pendingControlRequests,
    controlDenials,
    getControllerLock,
    getControllerLockState,
    getRoomPin,
    setRoomPin,
    requestControl,
    forceTakeover,
    handOverControl,
    denyControl,
    sendHeartbeat,
    connectionStatus,
    pendingTimerPlaceholders,
    undoTimerDelete,
    redoTimerDelete,
    undoRoomDelete,
    redoRoomDelete,
    getLiveCues,
    getLiveCueRecords,
    getLiveCueDiagnostics,
    getSections,
    getSegments,
    getCues,
    createCue,
    updateCue,
    deleteCue,
    reorderCues,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
    createSegment,
    updateSegment,
    deleteSegment,
    reorderSegments,
  } = ctx
  const subscribeToCompanionRoom = (ctx as typeof ctx & {
    subscribeToCompanionRoom?: (
      roomId: string,
      clientType: 'controller' | 'viewer',
      tokenOverride?: string,
    ) => void
  }).subscribeToCompanionRoom
  const registerCloudRoom = (ctx as typeof ctx & {
    registerCloudRoom?: (roomId: string, clientType: 'controller' | 'viewer') => void
  }).registerCloudRoom
  const unregisterCloudRoom = (ctx as typeof ctx & {
    unregisterCloudRoom?: (roomId: string) => void
  }).unregisterCloudRoom
  const clearLiveCues = (ctx as typeof ctx & {
    clearLiveCues?: (roomId: string) => void
  }).clearLiveCues
const addActiveRoomIntent = (ctx as typeof ctx & {
    addActiveRoomIntent?: (roomId: string) => void
  }).addActiveRoomIntent
  const removeActiveRoomIntent = (ctx as typeof ctx & {
    removeActiveRoomIntent?: (roomId: string) => void
  }).removeActiveRoomIntent
  const lastJoinKeyRef = useRef<string | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const debugCompanion =
    typeof import.meta !== 'undefined' &&
    ((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_DEBUG_COMPANION === 'true')

  const ensureCompanionJoin = useCallback(
    (options?: { force?: boolean; reason?: string }) => {
      if (!roomId) return
      if (!subscribeToCompanionRoom) return
      const intent = resolveControllerJoinIntent(lastJoinKeyRef.current, roomId, options)
      if (!intent.shouldJoin) return
      lastJoinKeyRef.current = intent.nextKey
      if (debugCompanion) {
        console.info(
          `[Companion] auto-joining controller for room ${roomId} reason=${options?.reason ?? 'auto'}`,
        )
      }
      subscribeToCompanionRoom(roomId, 'controller')
    },
    [debugCompanion, roomId, subscribeToCompanionRoom],
  )

  const bumpCompanionOnActivity = useCallback(
    (reason: string) => {
      if (!subscribeToCompanionRoom) return
      const now = Date.now()
      const idleMs = now - lastActivityRef.current
      lastActivityRef.current = now
      if (idleMs < 60_000) return
      ensureCompanionJoin({ force: true, reason })
    },
    [ensureCompanionJoin, subscribeToCompanionRoom],
  )

  const room = roomId ? getRoom(roomId) : undefined
  const roomAuthority = roomId && getRoomAuthority ? getRoomAuthority(roomId) : undefined

  useEffect(() => {
    if (!roomId || !registerCloudRoom) return
    const cloudActive =
      roomAuthority?.source === 'cloud' || (effectiveMode === 'cloud' && roomAuthority?.source !== 'companion')
    if (!cloudActive) {
      unregisterCloudRoom?.(roomId)
      return
    }
    registerCloudRoom(roomId, 'controller')
    return () => {
      unregisterCloudRoom?.(roomId)
    }
  }, [effectiveMode, registerCloudRoom, roomAuthority?.source, roomId, unregisterCloudRoom])
  const controllerLock = roomId ? getControllerLock(roomId) : null
  const isCloudOffline = connectionStatus !== 'online' && roomAuthority?.source === 'cloud'
  const canHandOver =
    (roomAuthority?.source === 'companion' || roomAuthority?.source === 'cloud') && !isCloudOffline
  const lockState = roomId ? getControllerLockState(roomId) : 'authoritative'
  const isReadOnly = lockState !== 'authoritative' || isCloudOffline
  const roomPinMeta = roomId ? (getRoomPin(roomId) as RoomPinMeta | null) : null
  const roomPin = roomPinMeta?.value ?? null
  const isOwner = Boolean(room?.ownerId && user?.uid && room.ownerId === user.uid)
  const canEditPin = Boolean(room && isOwner)
  const pinPermissionLabel = user ? 'Owner only' : 'Sign in to edit'
  const roomClientList = useMemo(() => {
    if (!roomId) return []
    return roomClients[roomId] ?? []
  }, [roomClients, roomId])
  const displacement = roomId ? controlDisplacements[roomId] : null
  const controlError = roomId ? controlErrors[roomId] : null
  const incomingRequest = roomId ? controlRequests[roomId] : null
  const pendingRequest = roomId ? pendingControlRequests[roomId] : null
  const denial = roomId ? controlDenials[roomId] : null
  const timers = useMemo(
    () => (roomId ? getTimers(roomId) : []),
    [getTimers, roomId],
  )
  const sections = useMemo(
    () => (roomId ? getSections(roomId) : []),
    [getSections, roomId],
  )
  const segments = useMemo(
    () => (roomId ? getSegments(roomId) : []),
    [getSegments, roomId],
  )
  const cues = useMemo(
    () => (roomId ? getCues(roomId) : []),
    [getCues, roomId],
  )

  // ---- Bootstrapping: auto-create default section when none exist ----
  const bootstrappedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!room || !roomId || isReadOnly) return
    if (sections.length > 0) return
    if (bootstrappedRef.current.has(roomId)) return
    bootstrappedRef.current.add(roomId)

    const bootstrap = async () => {
      try {
        const existingSections = await getDocs(
          query(collection(db, 'rooms', roomId, 'sections'), limit(1)),
        )
        if (!existingSections.empty) {
          return
        }

        const section = await createSection(roomId, { title: 'Session 1' })
        if (!section) return

        // Migrate existing unsectioned segments into the new section
        if (segments.length > 0) {
          for (const seg of segments) {
            if (!seg.sectionId) {
              await updateSegment(roomId, seg.id, { sectionId: section.id })
            }
          }
          // Migrate existing unsectioned timers: assign sectionId
          for (const timer of timers) {
            if (!timer.sectionId) {
              // If the timer has a segmentId, its section is inherited via the segment.
              // If no segmentId either, make it a section-level timer.
              await updateTimer(roomId, timer.id, { sectionId: section.id })
            }
          }
          // Migrate existing section-level cues without a sectionId
          for (const cue of cues) {
            if (!cue.segmentId && !cue.sectionId) {
              await updateCue(roomId, cue.id, { sectionId: section.id })
            }
          }
        } else if (timers.length > 0) {
          // No segments exist: create a default segment and assign all timers
          const segment = await createSegment(roomId, { title: 'New Segment', sectionId: section.id })
          if (!segment) return
          for (const timer of timers) {
            await updateTimer(roomId, timer.id, { sectionId: section.id, segmentId: segment.id })
          }
        } else {
          // Completely empty room: create default segment + timer
          const segment = await createSegment(roomId, { title: 'New Segment', sectionId: section.id })
          if (!segment) return
          await createTimer(roomId, {
            title: 'New Timer',
            duration: 5 * 60,
            sectionId: section.id,
            segmentId: segment.id,
          })
        }
      } catch (error) {
        console.error('[controller] bootstrapping failed:', error)
        bootstrappedRef.current.delete(roomId)
      }
    }
    void bootstrap()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, roomId, sections.length, isReadOnly])

  // ---- Migration: ensure section-level cues have a sectionId ----
  useEffect(() => {
    if (!room || !roomId || isReadOnly) return
    if (sections.length === 0) return
    const targetSectionId = sections[0]?.id
    if (!targetSectionId) return
    const needsMigration = cues.filter((cue) => !cue.segmentId && !cue.sectionId)
    if (needsMigration.length === 0) return

    const migrate = async () => {
      for (const cue of needsMigration) {
        await updateCue(roomId, cue.id, { sectionId: targetSectionId })
      }
    }

    void migrate()
  }, [cues, isReadOnly, room, roomId, sections, updateCue])

  const liveCueRecords = useMemo(
    () => (roomId ? getLiveCueRecords(roomId) : []),
    [getLiveCueRecords, roomId],
  )
  const liveCues = useMemo(
    () => (roomId ? getLiveCues(roomId) : []),
    [getLiveCues, roomId],
  )
  const liveCueDiagnostics =
    roomId && getLiveCueDiagnostics ? getLiveCueDiagnostics(roomId) : null
  const presentationRecords = useMemo(
    () =>
      companionReady
        ? liveCueRecords.filter(
            (record) => record.source === 'companion' && record.cue.source === 'powerpoint',
          )
        : [],
    [companionReady, liveCueRecords],
  )
  const presentationEntries = useMemo<PresentationEntry[]>(() => {
    if (!presentationRecords.length) return []
    const recordMap = new Map<string, LiveCueRecord>()
    const countMap = new Map<string, number>()
    presentationRecords.forEach((record) => {
      const key = buildPresentationKey(record)
      countMap.set(key, (countMap.get(key) ?? 0) + 1)
      const current = recordMap.get(key)
      if (!current || record.updatedAt > current.updatedAt) {
        recordMap.set(key, record)
      }
    })
    return [...recordMap.entries()]
      .map(([key, record]) => ({
        key,
        record,
        duplicateCount: countMap.get(key) ?? 1,
      }))
      .sort((a, b) => b.record.updatedAt - a.record.updatedAt)
  }, [presentationRecords])
  const presentationDetectedAt = presentationEntries.length
    ? Math.max(...presentationEntries.map((entry) => entry.record.updatedAt))
    : null
  const latestPresentationEntry = presentationEntries[0] ?? null
  const presentationCue = latestPresentationEntry?.record.cue ?? null
  const [lastPresentationDetectedAt, setLastPresentationDetectedAt] = useState<number | null>(null)
  const [lastPresentationEntry, setLastPresentationEntry] = useState<PresentationEntry | null>(null)
  const presentationDuplicatesHidden =
    presentationRecords.length > 0 ? presentationRecords.length - presentationEntries.length : 0
  const activeLiveCueId = room?.state.activeLiveCueId ?? null
  const activeLiveCue =
    (activeLiveCueId ? liveCues.find((cue) => cue.id === activeLiveCueId) : undefined) ??
    liveCues[0] ??
    null
  const canClearPresentation = Boolean(roomId && (activeLiveCue || presentationRecords.length > 0))
  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.info('[controller] activeLiveCue', {
      roomId: room?.id,
      activeLiveCueId,
      liveCuesCount: liveCues.length,
      firstCueId: liveCues[0]?.id ?? null,
      resolvedCueId: activeLiveCue?.id ?? null,
      videoCount: activeLiveCue?.metadata?.videos?.length ?? 0,
      videoDuration: activeLiveCue?.metadata?.videoDuration ?? null,
    })
  }, [activeLiveCue, activeLiveCueId, liveCues, room?.id])
  const [controlNow, setControlNow] = useState(() => Date.now())
  const activeRoomClients = useMemo(() => {
    const now = controlNow
    return roomClientList.filter((client) => {
      if (typeof client.lastHeartbeat !== 'number') return true
      const { maxAgeMs } = getClientPresenceThresholds(client.source)
      return now - client.lastHeartbeat < maxAgeMs
    })
  }, [controlNow, roomClientList])
  const displayRoomClients = useMemo(() => {
    const source =
      roomAuthority?.source === 'cloud' || roomAuthority?.source === 'companion'
        ? roomAuthority.source
        : undefined
    return mergeClientSourcesForDisplay(activeRoomClients, source)
  }, [activeRoomClients, roomAuthority?.source])
  const [ignoredRequestTs, setIgnoredRequestTs] = useState<number | null>(null)
  const [dismissedDenialTs, setDismissedDenialTs] = useState<number | null>(null)
  const [dismissedDisplacementTs, setDismissedDisplacementTs] = useState<number | null>(null)
  const [dismissedErrorTs, setDismissedErrorTs] = useState<number | null>(null)
  const [controlBarCollapsed, setControlBarCollapsed] = useState(false)
  const [controlBarDismissedAt, setControlBarDismissedAt] = useState(0)
  const [presentationBannerDismissedAt, setPresentationBannerDismissedAt] = useState<number | null>(
    null,
  )
  const [presentationImportOpen, setPresentationImportOpen] = useState(false)
  const [presentationMappings, setPresentationMappings] = useState<
    Record<string, { targetId: string; customLabel: string }>
  >({})
  const [reauthHintAt, setReauthHintAt] = useState<number | null>(null)
  const [forcePromptOpen, setForcePromptOpen] = useState(false)
  const [forcePromptMode, setForcePromptMode] = useState<'pin' | 'confirm'>('pin')
  const [forcePinDraft, setForcePinDraft] = useState('')
  const [forceTakeoverInFlight, setForceTakeoverInFlight] = useState(false)
  const forceTakeoverTimeoutRef = useRef<number | null>(null)
  const forcePinInputRef = useRef<HTMLInputElement | null>(null)
  const pinInputRef = useRef<HTMLInputElement | null>(null)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [handoverTargetId, setHandoverTargetId] = useState<string | null>(null)
  const [viewerOnly, setViewerOnly] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ontime:viewerOnly') === 'true'
  })
  const controlsAllowed = canPerformControllerAction({ viewerOnly, isReadOnly })
  const [pinHidden, setPinHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ontime:pinHidden') === 'true'
  })
  const [pinEditing, setPinEditing] = useState(false)
  const [pinDraft, setPinDraft] = useState(roomPin ?? '')
  useEffect(() => {
    if (!pinEditing) return
    const id = window.setTimeout(() => pinInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [pinEditing])
  const [requestChimeEnabled, setRequestChimeEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('ontime:requestChime')
    return stored !== 'false'
  })
  const lockAgeMs = controllerLock ? Math.max(0, controlNow - controllerLock.lastHeartbeat) : null
  const isLockStale = lockAgeMs !== null && lockAgeMs > 90_000
  const lastActiveLabel =
    lockAgeMs === null
      ? 'Unknown'
      : lockAgeMs < 60_000
        ? 'Just now'
        : `${Math.floor(lockAgeMs / 60_000)}m ago`
  const lockOwnerLabel =
    controllerLock?.userName && controllerLock?.deviceName
      ? `${controllerLock.userName} · ${controllerLock.deviceName}`
      : controllerLock?.userName ?? controllerLock?.deviceName ?? 'another device'
  const availableHandoverTargets = useMemo(
    () =>
      displayRoomClients.filter(
        (client) => client.targetClientId !== controllerLock?.clientId,
      ),
    [controllerLock?.clientId, displayRoomClients],
  )
  const canForceNow = true
  const visibleDenial = denial && dismissedDenialTs !== denial.deniedAt ? denial : null
  const visibleDisplacement = displacement && dismissedDisplacementTs !== displacement.takenAt ? displacement : null
  const visibleError = controlError && dismissedErrorTs !== controlError.receivedAt ? controlError : null
  const latestControlEventAt = Math.max(
    denial?.deniedAt ?? 0,
    controlError?.receivedAt ?? 0,
    displacement?.takenAt ?? 0,
    pendingRequest?.requestedAt ?? 0,
  )
  const showControlBar = Boolean(
    roomId &&
      (lockState !== 'authoritative' || viewerOnly) &&
      (!controlBarCollapsed || latestControlEventAt > controlBarDismissedAt),
  )
  const controlBarTone = visibleDisplacement || visibleDenial || visibleError ? 'rose' : 'amber'
  const reauthHintActive = reauthHintAt !== null && controlNow - reauthHintAt < 12_000
  const controlTitle = visibleDisplacement
    ? 'Control moved'
    : visibleDenial
      ? 'Request declined'
      : visibleError
        ? 'Action not completed'
        : viewerOnly
          ? 'Viewer mode'
          : isLockStale
            ? 'Room inactive'
            : 'Controls locked'
  const controlDetail = visibleDisplacement
    ? `Now controlled by ${visibleDisplacement.takenByName ?? visibleDisplacement.takenByUserName ?? 'another device'} at ${formatDate(
        visibleDisplacement.takenAt,
        room?.timezone ?? 'UTC',
      )}.`
    : visibleDenial
      ? `Request declined by ${visibleDenial.deniedByName ?? visibleDenial.deniedByUserName ?? 'the current controller'}.`
      : visibleError
        ? `We could not complete that action. ${visibleError.message}`
        : `Controlled by ${lockOwnerLabel}. Last active ${lastActiveLabel}.`

  useEffect(() => {
    lastActivityRef.current = Date.now()
    ensureCompanionJoin({ reason: 'auto' })
  }, [ensureCompanionJoin, roomId])

  useEffect(() => {
if (roomId) addActiveRoomIntent?.(roomId)
    return () => { if (roomId) removeActiveRoomIntent?.(roomId) }
  }, [roomId, addActiveRoomIntent, removeActiveRoomIntent])

  useEffect(() => {
    if (!roomId) return
    if (!subscribeToCompanionRoom) return
    const handleMouseMove = () => {
      const now = Date.now()
      const idleMs = now - lastActivityRef.current
      if (idleMs <= 300_000) return
      lastActivityRef.current = now
      ensureCompanionJoin({ force: true, reason: 'idle-move' })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [ensureCompanionJoin, handshakeStatus, roomId, subscribeToCompanionRoom])

  const activeTimer = timers.find((timer) => timer.id === room?.state.activeTimerId)
  const currentRoomId = room?.id
  const isRunning = room?.state.isRunning ?? false
  const [selectedTimerId, setSelectedTimerId] = useState<string | null>(
    () => activeTimer?.id ?? null,
  )
  const [qrOpen, setQrOpen] = useState(false)
  const [qrError, setQrError] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [lanModalOpen, setLanModalOpen] = useState(false)
  const [lanPairing, setLanPairing] = useState<LanPairingInfo | null>(null)
  const [lanPairingStatus, setLanPairingStatus] = useState<LanPairingStatus | null>(null)
  const [lanPairingError, setLanPairingError] = useState<string | null>(null)
  const [lanPairingLoading, setLanPairingLoading] = useState(false)
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [titleInput, setTitleInput] = useState(room?.title ?? '')
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const [isTimezoneEditing, setIsTimezoneEditing] = useState(false)
  const [timezoneInput, setTimezoneInput] = useState(room?.timezone ?? '')
  const timezoneInputRef = useRef<HTMLInputElement | null>(null)
  const [shortcutScope, setShortcutScope] = useState<'controls' | 'rundown'>('controls')
  const [placeholderNow, setPlaceholderNow] = useState(() => Date.now())
  const lastRequestChimeRef = useRef<number | null>(null)

  const effectiveSelectedTimerId = useMemo(() => {
    if (selectedTimerId && timers.some((timer) => timer.id === selectedTimerId)) {
      return selectedTimerId
    }
    return activeTimer?.id ?? null
  }, [activeTimer?.id, selectedTimerId, timers])

  const selectedTimer =
    timers.find((timer) => timer.id === effectiveSelectedTimerId) ?? activeTimer
  const timezoneOptions = useMemo(() => getAllTimezones(), [])
  const timezoneListId = room ? `timezone-${room.id}` : 'timezone-global'
  const undoPlaceholder = useMemo(() => {
    if (!roomId) return null
    const placeholders = (pendingTimerPlaceholders[roomId] ?? []).filter(
      (entry) => entry.expiresAt > placeholderNow,
    )
    if (!placeholders.length) return null
    const first = [...placeholders].sort((a, b) => a.order - b.order)[0]
    const orderedTimers = [...timers].sort((a, b) => a.order - b.order)
    const insertion = orderedTimers.findIndex((timer) => timer.order > first.order)
    const index = insertion === -1 ? orderedTimers.length : insertion
    return { index, title: first.title, timerId: first.timerId, expiresAt: first.expiresAt }
  }, [pendingTimerPlaceholders, placeholderNow, roomId, timers])

  useEffect(() => {
    if (isTimezoneEditing && timezoneInputRef.current) {
      timezoneInputRef.current.focus()
      timezoneInputRef.current.select()
    }
    if (isTitleEditing && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isTimezoneEditing, isTitleEditing])

  useEffect(() => {
    const id = window.setInterval(() => setPlaceholderNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [setPlaceholderNow])

  useEffect(() => {
    const id = window.setInterval(() => setControlNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('ontime:viewerOnly', viewerOnly ? 'true' : 'false')
  }, [viewerOnly])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('ontime:pinHidden', pinHidden ? 'true' : 'false')
  }, [pinHidden])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('ontime:requestChime', requestChimeEnabled ? 'true' : 'false')
  }, [requestChimeEnabled])

  useEffect(() => {
    if (presentationEntries.length > 0) return
    setPresentationImportOpen(false)
  }, [presentationEntries.length])

  const playRequestChime = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!requestChimeEnabled) return
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return
      const ctx = new AudioContextClass()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = 660
      gain.gain.value = 0.08
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.18)
      osc.onended = () => {
        ctx.close().catch(() => undefined)
      }
    } catch {
      // ignore audio failures
    }
  }, [requestChimeEnabled])

  useEffect(() => {
    if (!incomingRequest) return
    if (ignoredRequestTs === incomingRequest.requestedAt) return
    if (lastRequestChimeRef.current === incomingRequest.requestedAt) return
    lastRequestChimeRef.current = incomingRequest.requestedAt
    playRequestChime()
  }, [ignoredRequestTs, incomingRequest, playRequestChime])

  useEffect(() => {
    if (!roomId) return
    if (!sendHeartbeat) return
    if (roomAuthority?.source === 'cloud') return
    const beat = () => sendHeartbeat(roomId)
    beat()
    const id = window.setInterval(beat, 30_000)
    return () => window.clearInterval(id)
  }, [roomAuthority?.source, roomId, sendHeartbeat])

  useEffect(() => {
    if (!denial) return
    const id = window.setTimeout(() => {
      setDismissedDenialTs(denial.deniedAt)
      setControlBarCollapsed(true)
      setControlBarDismissedAt(Math.max(latestControlEventAt, Date.now()))
    }, 10_000)
    return () => window.clearTimeout(id)
  }, [denial, latestControlEventAt])

  useEffect(() => {
    if (!controlError) return
    const id = window.setTimeout(() => {
      setDismissedErrorTs(controlError.receivedAt)
      setControlBarCollapsed(true)
      setControlBarDismissedAt(Math.max(latestControlEventAt, Date.now()))
    }, 8_000)
    return () => window.clearTimeout(id)
  }, [controlError, latestControlEventAt])

  useEffect(() => {
    if (!displacement) return
    const id = window.setTimeout(() => {
      setDismissedDisplacementTs(displacement.takenAt)
      setControlBarCollapsed(true)
      setControlBarDismissedAt(Math.max(latestControlEventAt, Date.now()))
    }, 12_000)
    return () => window.clearTimeout(id)
  }, [displacement, latestControlEventAt])

  useEffect(() => {
    if (denial && dismissedDenialTs !== denial.deniedAt) {
      if (denial.deniedAt > controlBarDismissedAt) {
        setControlBarCollapsed(false)
      }
    }
  }, [controlBarDismissedAt, denial, dismissedDenialTs])

  useEffect(() => {
    if (controlError && dismissedErrorTs !== controlError.receivedAt) {
      if (controlError.receivedAt > controlBarDismissedAt) {
        setControlBarCollapsed(false)
      }
    }
  }, [controlBarDismissedAt, controlError, dismissedErrorTs])

  useEffect(() => {
    if (displacement && dismissedDisplacementTs !== displacement.takenAt) {
      if (displacement.takenAt > controlBarDismissedAt) {
        setControlBarCollapsed(false)
      }
    }
  }, [controlBarDismissedAt, displacement, dismissedDisplacementTs])

  useEffect(() => {
    if (!room) return
    setTitleInput(room.title)
    setTimezoneInput(room.timezone)
    // This effect mirrors incoming room props to local inputs; avoids stale values when switching rooms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.title, room?.timezone])

  useEffect(() => {
    if (pinEditing) return
    setPinDraft(roomPin ?? '')
  }, [pinEditing, roomPin])

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
      const metaPressed = isMac ? event.metaKey : event.ctrlKey
      if (!metaPressed || !roomId) return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      if (isReadOnly) {
        setControlBarCollapsed(false)
        return
      }
      if (isUndo) {
        event.preventDefault()
        void undoRoomDelete()
      } else if (isRedo) {
        event.preventDefault()
        void redoRoomDelete()
      }
    }
    window.addEventListener('keydown', handleUndoShortcut)
    return () => window.removeEventListener('keydown', handleUndoShortcut)
  }, [isReadOnly, redoRoomDelete, roomId, undoRoomDelete])

  const controlTargetTimerId =
    shortcutScope === 'rundown' && selectedTimerId
      ? selectedTimerId
      : room?.state.activeTimerId ?? null

  const startControlTimer = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !controlTargetTimerId) return
    if (controlTargetTimerId !== room?.state.activeTimerId) {
      setSelectedTimerId(controlTargetTimerId)
      setShortcutScope('rundown')
    }
    bumpCompanionOnActivity('play')
    void startTimer(currentRoomId, controlTargetTimerId)
  }

  const pauseControlTimer = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !controlTargetTimerId) return
    if (controlTargetTimerId !== room?.state.activeTimerId) {
      setSelectedTimerId(controlTargetTimerId)
      setShortcutScope('rundown')
    }
    bumpCompanionOnActivity('pause')
    if (controlTargetTimerId !== room.state.activeTimerId) {
      void setActiveTimer(room.id, controlTargetTimerId)
    }
    void pauseTimer(currentRoomId)
  }

  const resetControlTimer = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !controlTargetTimerId) return
    if (controlTargetTimerId !== room?.state.activeTimerId) {
      setSelectedTimerId(controlTargetTimerId)
      setShortcutScope('rundown')
    }
    bumpCompanionOnActivity('reset')
    if (controlTargetTimerId === room.state.activeTimerId) {
      void resetTimer(currentRoomId)
      return
    }
    void resetTimerProgress(currentRoomId, controlTargetTimerId)
  }

  const nudgeActiveTimer = (deltaMs: number) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !room) return
    bumpCompanionOnActivity('nudge')
    if (room.state.isRunning) {
      void nudgeTimer(currentRoomId, deltaMs)
      return
    }
    if (activeTimer) {
      const nextDurationSec = Math.max(0, Math.round(activeTimer.duration + deltaMs / 1000))
      void updateTimer(currentRoomId, activeTimer.id, { duration: nextDurationSec })
    }
  }

  const handleEditTimer = (
    timerId: string,
    patch: { title?: string; speaker?: string; duration?: number },
  ) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId) return
    void updateTimer(currentRoomId, timerId, patch)
  }

  const handleReorderTimer = (sourceId: string, targetIndex: number) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId) return
    bumpCompanionOnActivity('reorder')
    void reorderTimer(currentRoomId, sourceId, targetIndex)
  }

  const handleReorderSegmentTimers = (segmentId: string, timerIds: string[]) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId) return
    bumpCompanionOnActivity('reorder')
    const now = Date.now()
    timerIds.forEach((timerId, idx) => {
      void updateTimer(currentRoomId, timerId, {
        segmentId,
        segmentOrder: idx * 10,
        updatedAt: now,
      })
    })
  }

  const engine = useTimerEngine({
    durationSec: activeTimer?.duration ?? 0,
    isRunning: room?.state.isRunning ?? false,
    startedAt: room?.state.startedAt ?? null,
    elapsedOffset: room?.state.elapsedOffset ?? 0,
    warningSec: room?.config.warningSec ?? 120,
    criticalSec: room?.config.criticalSec ?? 30,
  })
  const clockTime = useClock(room?.timezone ?? 'UTC', room?.state.clockMode ?? '24h')

  const activeIndex = activeTimer
    ? timers.findIndex((timer) => timer.id === activeTimer.id)
    : -1
  const prevTimer = activeIndex > 0 ? timers[activeIndex - 1] : null
  const nextTimer =
    activeIndex >= 0 && activeIndex < timers.length - 1
      ? timers[activeIndex + 1]
      : null

  const handleStartPrevTimer = useCallback(() => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!prevTimer || !room) return
    bumpCompanionOnActivity('set-active')
    setSelectedTimerId(prevTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, prevTimer.id)
  }, [bumpCompanionOnActivity, isReadOnly, prevTimer, room, setActiveTimer])

  const handleStartNextTimer = useCallback(() => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!nextTimer || !room) return
    bumpCompanionOnActivity('set-active')
    setSelectedTimerId(nextTimer.id)
    setShortcutScope('controls')
    void setActiveTimer(room.id, nextTimer.id)
  }, [bumpCompanionOnActivity, isReadOnly, nextTimer, room, setActiveTimer])

  const handleToggleClock = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    void setClockMode(room.id, !room.state.showClock)
  }

  const remainingLookup = useMemo(() => {
    if (!room) return {}
    const { progress, activeTimerId, elapsedOffset } = room.state
    const lookup: Record<string, string> = {}
    timers.forEach((timer) => {
      if (timer.id === activeTimerId) {
        lookup[timer.id] = engine ? engine.display : formatDuration(timer.duration * 1000 - elapsedOffset)
        return
      }
      const elapsed = progress?.[timer.id] ?? 0
      const remainingMs = timer.duration * 1000 - elapsed
      lookup[timer.id] = formatDuration(remainingMs)
    })
    return lookup
  }, [engine, room, timers])

  const presentationMappingOptions = useMemo(
    () =>
      timers.map((timer) => ({
        value: timer.id,
        label: timer.title || 'Untitled timer',
      })),
    [timers],
  )

  const pipTimer =
    selectedTimer && selectedTimer.id !== activeTimer?.id
      ? selectedTimer
      : nextTimer ?? prevTimer
  const pipLabel =
    selectedTimer && selectedTimer.id !== activeTimer?.id
      ? 'Selected'
      : nextTimer
        ? 'Next up'
        : prevTimer
          ? 'Previous'
          : 'Standby'
  const pipRemaining = pipTimer
    ? remainingLookup[pipTimer.id] ?? formatDuration(pipTimer.duration * 1000)
    : '00:00'

  const isBasicTier = room?.tier === 'basic'
  const showControlTier = room?.tier === 'show_control' || room?.tier === 'production'
  const showControlEnabled = showControlTier && room?.features?.showControl
  const presentationFeatureEnabled = Boolean(room?.features?.powerpoint)
  const presentationCapability =
    companion.capabilities.powerpoint || companion.capabilities.externalVideo
  const capabilityMissing = companionReady && !presentationCapability
  const powerpointMissing = companionReady && !companion.capabilities.powerpoint
  const showControlBlocked = showControlTier && (!room?.features?.showControl || capabilityMissing)
  const simpleSurfaceTone = isBasicTier
    ? 'border-slate-800/70 bg-slate-900/50'
    : 'border-slate-900/70 bg-slate-950/70'
  const simplePanelTone = isBasicTier
    ? 'border-slate-800/60 bg-slate-900/40'
    : 'border-slate-800 bg-slate-950/70'
  const showControlUi = showControlEnabled && !capabilityMissing
  const showPresentationBanner = Boolean(
    showControlEnabled &&
      presentationFeatureEnabled &&
      lastPresentationDetectedAt &&
      lastPresentationDetectedAt > (presentationBannerDismissedAt ?? 0),
  )
  const isMacPlatform = companionReady && companion.systemInfo?.platform === 'darwin'
  useEffect(() => {
    if (!presentationDetectedAt) return
    setLastPresentationDetectedAt((prev) =>
      prev === presentationDetectedAt ? prev : presentationDetectedAt,
    )
    setLastPresentationEntry((prev) => {
      if (!latestPresentationEntry) return prev
      if (!prev) return latestPresentationEntry
      const nextUpdatedAt = latestPresentationEntry.record.updatedAt
      const prevUpdatedAt = prev.record.updatedAt
      if (prev.key === latestPresentationEntry.key && prevUpdatedAt === nextUpdatedAt) {
        return prev
      }
      return latestPresentationEntry
    })
  }, [
    presentationDetectedAt,
    latestPresentationEntry,
    latestPresentationEntry?.key,
    latestPresentationEntry?.record.updatedAt,
  ])
  useEffect(() => {
    if (presentationEntries.length > 0) return
    setLastPresentationDetectedAt(null)
    setLastPresentationEntry(null)
  }, [presentationEntries.length])
  useEffect(() => {
    if (showControlEnabled && presentationFeatureEnabled) return
    setPresentationImportOpen(false)
  }, [presentationFeatureEnabled, showControlEnabled])


  const presentationTimingWarning = useMemo(() => {
    return presentationEntries.some(({ record }) => {
      const metadata = record.cue.metadata
      if (!metadata) return false
      if (metadata.videoTimingUnavailable) return true
      const expectsTiming = Boolean(metadata.videoPlaying) || record.cue.source === 'external_video'
      const missingTiming =
        metadata.videoDuration === undefined &&
        metadata.videoElapsed === undefined &&
        metadata.videoRemaining === undefined
      return expectsTiming && missingTiming
    })
  }, [presentationEntries])

  const mainDisplay = room?.state.showClock ? clockTime : engine.display
  const mainStatusLabel = room?.state.showClock
    ? 'Clock'
    : engine.status === 'default'
      ? 'On schedule'
      : engine.status === 'warning'
        ? 'Warning'
        : engine.status === 'critical'
          ? 'Critical'
          : 'Overtime'

  const pendingRequestAgeMs =
    pendingRequest ? Math.max(0, controlNow - pendingRequest.requestedAt) : null
  const forceTakeoverReady = pendingRequestAgeMs !== null && pendingRequestAgeMs >= 30_000
  const requestCountdown =
    pendingRequestAgeMs === null || forceTakeoverReady
      ? null
      : Math.ceil((30_000 - pendingRequestAgeMs) / 1000)

  const attemptReauth = useCallback(async (): Promise<boolean> => {
    if (!auth || !auth.currentUser) {
      if (user) return true
      window.alert('Re-auth unavailable. Use the room PIN instead.')
      return false
    }
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await reauthenticateWithPopup(auth.currentUser, provider)
      return true
    } catch {
      setReauthHintAt(Date.now())
      setControlBarCollapsed(false)
      return false
    }
  }, [user])

  const normalizePin = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.length < 4 || digits.length > 8) return null
    return digits
  }, [])

  const startForceTakeoverRequest = useCallback(() => {
    setForceTakeoverInFlight(true)
    if (forceTakeoverTimeoutRef.current !== null) {
      window.clearTimeout(forceTakeoverTimeoutRef.current)
    }
    forceTakeoverTimeoutRef.current = window.setTimeout(() => {
      setForceTakeoverInFlight(false)
      forceTakeoverTimeoutRef.current = null
    }, 12_000)
  }, [])

  useEffect(() => {
    if (!forceTakeoverInFlight) return
    if (controlError || denial || displacement) {
      setForceTakeoverInFlight(false)
      if (forceTakeoverTimeoutRef.current !== null) {
        window.clearTimeout(forceTakeoverTimeoutRef.current)
        forceTakeoverTimeoutRef.current = null
      }
    }
  }, [controlError, denial, displacement, forceTakeoverInFlight])

  const handleForceTakeover = useCallback(() => {
    if (!room || !controlsAllowed) {
      setControlBarCollapsed(false)
      return
    }
    setForcePromptMode(forceTakeoverReady ? 'confirm' : 'pin')
    setForcePinDraft('')
    setForcePromptOpen(true)
  }, [controlsAllowed, forceTakeoverReady, room])

  useEffect(() => {
    if (!forcePromptOpen || forcePromptMode !== 'pin') return
    const id = window.setTimeout(() => forcePinInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [forcePromptOpen, forcePromptMode])

  const submitForceTakeover = useCallback(async () => {
    if (!room || !controlsAllowed) {
      setControlBarCollapsed(false)
      return
    }
    if (forcePromptMode === 'confirm') {
      startForceTakeoverRequest()
      forceTakeover(room.id)
      setForcePromptOpen(false)
      return
    }
    const trimmed = forcePinDraft.trim()
    if (trimmed) {
      const normalized = normalizePin(trimmed)
      if (!normalized) {
        window.alert('PIN must be 4-8 digits.')
        return
      }
      startForceTakeoverRequest()
      forceTakeover(room.id, { pin: normalized })
      setForcePromptOpen(false)
      return
    }
    const ok = await attemptReauth()
    if (!ok) return
    startForceTakeoverRequest()
    forceTakeover(room.id, { reauthenticated: true })
    setForcePromptOpen(false)
  }, [attemptReauth, controlsAllowed, forcePinDraft, forcePromptMode, forceTakeover, normalizePin, room, startForceTakeoverRequest])

  const handleSetPin = useCallback(() => {
    if (!room) return
    setPinDraft(roomPin ?? '')
    setPinEditing(true)
  }, [room, roomPin])

  const handleSavePin = useCallback(() => {
    if (!room) return
    const trimmed = pinDraft.trim()
    if (!trimmed) {
      setRoomPin(room.id, null)
      setPinEditing(false)
      return
    }
    const normalized = normalizePin(trimmed)
    if (!normalized) {
      window.alert('PIN must be 4-8 digits.')
      return
    }
    setRoomPin(room.id, normalized)
    setPinEditing(false)
  }, [normalizePin, pinDraft, room, setRoomPin])

  const handleCancelPin = useCallback(() => {
    setPinDraft(roomPin ?? '')
    setPinEditing(false)
  }, [roomPin])

  const handleCopyPin = useCallback(async () => {
    if (!roomPin) return
    try {
      await navigator.clipboard.writeText(roomPin)
      window.alert('PIN copied to clipboard')
    } catch {
      window.prompt('Copy PIN', roomPin)
    }
  }, [roomPin])

  const handleDismissControlBar = useCallback(() => {
    if (denial) setDismissedDenialTs(denial.deniedAt)
    if (controlError) setDismissedErrorTs(controlError.receivedAt)
    if (displacement) setDismissedDisplacementTs(displacement.takenAt)
    setControlBarCollapsed(true)
    setControlBarDismissedAt(Math.max(latestControlEventAt, Date.now()))
  }, [controlError, denial, displacement, latestControlEventAt])

  const updatePresentationMapping = useCallback(
    (key: string, patch: Partial<{ targetId: string; customLabel: string }>) => {
      setPresentationMappings((prev) => ({
        ...prev,
        [key]: {
          targetId: prev[key]?.targetId ?? 'unassigned',
          customLabel: prev[key]?.customLabel ?? '',
          ...patch,
        },
      }))
    },
    [],
  )

  const handleDismissPresentationBanner = useCallback(() => {
    if (lastPresentationDetectedAt) {
      setPresentationBannerDismissedAt(lastPresentationDetectedAt)
    }
    setPresentationImportOpen(false)
  }, [lastPresentationDetectedAt])

  const handleConfirmHandover = useCallback(() => {
    if (!room || !handoverTargetId || !controlsAllowed) {
      setControlBarCollapsed(false)
      return
    }
    const target = availableHandoverTargets.find(
      (client) => client.targetClientId === handoverTargetId,
    )
    if (!target) return
    handOverControl(room.id, handoverTargetId)
    setHandoverOpen(false)
    setHandoverTargetId(null)
  }, [availableHandoverTargets, controlsAllowed, handOverControl, handoverTargetId, room])

  const handleTimezoneSave = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    const next = timezoneInput.trim()
    if (!next) {
      setTimezoneInput(room.timezone)
      setIsTimezoneEditing(false)
      return
    }
    void updateRoomMeta(room.id, { timezone: next })
    setIsTimezoneEditing(false)
  }

  const handleTitleSave = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    const next = titleInput.trim()
    if (!next || next === room.title) {
      setTitleInput(room.title)
      setIsTitleEditing(false)
      return
    }
    void updateRoomMeta(room.id, { title: next })
    setIsTitleEditing(false)
  }

  const handleShare = async () => {
    if (!viewerUrl || !room) return
    if (navigator.share) {
      try {
        await navigator.share({ title: room.title, url: viewerUrl })
        return
      } catch {
        // fall back to clipboard if share was cancelled or unavailable
      }
    }
    try {
      await navigator.clipboard.writeText(viewerUrl)
      window.alert('Viewer link copied to clipboard')
    } catch {
      window.prompt('Copy viewer link', viewerUrl)
    }
  }

  const formatLanTime = (timestamp?: number) => {
    if (!timestamp) return 'Unknown'
    return new Date(timestamp).toLocaleTimeString()
  }

  const getCompanionAuthToken = useCallback(async () => {
    if (companion.token) return companion.token
    return (await companion.fetchToken()) ?? null
  }, [companion])

  const loadLanPairing = useCallback(async () => {
    if (!roomId) return
    setLanPairingLoading(true)
    setLanPairingError(null)
    try {
      const token = await getCompanionAuthToken()
      if (!token) {
        setLanPairingError('Companion token unavailable.')
        return
      }
      const pairing = await createLanPairing(roomId, token, { reuse: true })
      setLanPairing(pairing)
      const status = await fetchLanPairingStatus(roomId, token)
      setLanPairingStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LAN pairing unavailable.'
      setLanPairingError(message)
    } finally {
      setLanPairingLoading(false)
    }
  }, [getCompanionAuthToken, roomId])

  useEffect(() => {
    if (!lanModalOpen) return
    if (!companionReady) return
    void loadLanPairing()
  }, [companionReady, lanModalOpen, loadLanPairing])

  const refreshLanStatus = useCallback(async () => {
    if (!roomId) return
    try {
      const token = await getCompanionAuthToken()
      if (!token) {
        setLanPairingError('Companion token unavailable.')
        return
      }
      const status = await fetchLanPairingStatus(roomId, token)
      setLanPairingStatus(status)
    } catch {
      // ignore
    }
  }, [getCompanionAuthToken, roomId])

  const refreshLanPairingCode = useCallback(async () => {
    if (!roomId) return
    setLanPairingLoading(true)
    setLanPairingError(null)
    try {
      const token = await getCompanionAuthToken()
      if (!token) {
        setLanPairingError('Companion token unavailable.')
        return
      }
      const pairing = await createLanPairing(roomId, token, { reuse: false })
      setLanPairing(pairing)
      const status = await fetchLanPairingStatus(roomId, token)
      setLanPairingStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LAN pairing unavailable.'
      setLanPairingError(message)
    } finally {
      setLanPairingLoading(false)
    }
  }, [getCompanionAuthToken, roomId])

  const handleRevokeLanViewer = useCallback(
    async (tokenId: string) => {
      if (!roomId) return
      try {
        const token = await getCompanionAuthToken()
        if (!token) {
          setLanPairingError('Companion token unavailable.')
          return
        }
        await revokeLanViewer(roomId, tokenId, token)
        await refreshLanStatus()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Revoke failed.'
        setLanPairingError(message)
      }
    },
    [getCompanionAuthToken, refreshLanStatus, roomId],
  )

  const handleResetLanViewers = useCallback(async () => {
    if (!roomId) return
    const confirmReset = window.confirm('Reset all paired viewer tokens for this room?')
    if (!confirmReset) return
    setLanPairingLoading(true)
    setLanPairingError(null)
    try {
      const token = await getCompanionAuthToken()
      if (!token) {
        setLanPairingError('Companion token unavailable.')
        return
      }
      await resetLanViewers(roomId, token)
      const status = await fetchLanPairingStatus(roomId, token)
      setLanPairingStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Reset failed.'
      setLanPairingError(message)
    } finally {
      setLanPairingLoading(false)
    }
  }, [getCompanionAuthToken, roomId])

  const handleAddTimer = (segmentIdOrSectionTag?: string) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return

    // If prefixed with __section__, this is a section-level timer (no segment)
    const isSectionLevel = segmentIdOrSectionTag?.startsWith('__section__') ?? false
    const explicitSectionId = isSectionLevel ? segmentIdOrSectionTag!.slice('__section__'.length) : undefined
    const segmentId = isSectionLevel ? undefined : segmentIdOrSectionTag

    // Resolve sectionId from the segment, explicit section tag, or fall back to first section
    const segment = segmentId ? segments.find((candidate) => candidate.id === segmentId) : undefined
    const sectionId = explicitSectionId ?? segment?.sectionId ?? (sections.length > 0 ? sections[0].id : undefined)

    const timerInput: { title: string; duration: number; speaker?: string; sectionId?: string; segmentId?: string } = {
      title: 'New Timer',
      duration: 5 * 60,
      speaker: '',
      ...(sectionId ? { sectionId } : {}),
      ...(segmentId ? { segmentId } : {}),
    }
    void createTimer(room.id, timerInput).then((newTimer) => {
      if (!newTimer) return
      if (segmentId) {
        const segmentTimers = timers.filter((timer) => timer.segmentId === segmentId)
        const segmentOrders = segmentTimers
          .map((timer) => timer.segmentOrder)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        const nextOrder = segmentOrders.length ? Math.max(...segmentOrders) + 10 : 0
        void updateTimer(room.id, newTimer.id, { segmentOrder: nextOrder })
        if (segment && !segment.primaryTimerId && nextOrder === 0) {
          void updateSegment(room.id, segmentId, { primaryTimerId: newTimer.id })
        }
      }
      setSelectedTimerId(newTimer.id)
      setShortcutScope('rundown')
    })
  }

  const handleDeleteTimer = (timerId: string) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    void deleteTimer(room.id, timerId)
  }

  const handleResetTimer = (timerId: string) => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    bumpCompanionOnActivity('reset')
    if (room.state.activeTimerId === timerId) {
      void resetTimer(room.id)
      return
    }
    void resetTimerProgress(room.id, timerId)
  }

  // Section/Segment CRUD handlers
  const handleAddSection = () => {
    if (isReadOnly || !room) return
    void createSection(room.id, { title: 'New Section' })
  }

  const handleEditSection = (sectionId: string, patch: Partial<{ title: string; notes: string }>) => {
    if (isReadOnly || !room) return
    void updateSection(room.id, sectionId, patch)
  }

  const handleDeleteSection = (sectionId: string) => {
    if (isReadOnly || !room) return
    void deleteSection(room.id, sectionId)
  }

  const handleReorderSections = (sectionIds: string[]) => {
    if (isReadOnly || !room) return
    void reorderSections(room.id, sectionIds)
  }

  const handleAddSegment = (sectionId?: string) => {
    if (isReadOnly || !room) return
    void createSegment(room.id, {
      title: 'New Segment',
      sectionId,
    })
  }

  const handleEditSegment = (segmentId: string, patch: Partial<{ title: string; notes: string; sectionId: string }>) => {
    if (isReadOnly || !room) return
    void updateSegment(room.id, segmentId, patch)
  }

  const handleDeleteSegment = (segmentId: string) => {
    if (isReadOnly || !room) return
    void deleteSegment(room.id, segmentId)
  }

  const handleReorderSegments = (sectionId: string, segmentIds: string[]) => {
    if (isReadOnly || !room) return
    void reorderSegments(room.id, sectionId, segmentIds)
  }

  const handleMoveSegmentToSection = (segmentId: string, fromSectionId: string, targetSectionId: string, targetIndex: number) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('reorder')
    if (fromSectionId === targetSectionId) return
    // Use null (not undefined) so updateSegment actually clears the field
    const newSectionId: string | null = targetSectionId === '__none__' ? null : targetSectionId
    // Update the segment's sectionId
    void updateSegment(room.id, segmentId, { sectionId: newSectionId } as Partial<Omit<SegmentType, 'id' | 'roomId'>>)

    // Reorder target section's segments (insert at targetIndex)
    const targetKey = newSectionId ?? undefined
    const targetSegments = segments
      .filter((seg) => seg.sectionId === targetKey && seg.id !== segmentId)
      .sort((a, b) => a.order - b.order)
    const clamped = Math.max(0, Math.min(targetIndex, targetSegments.length))
    const movedSeg = segments.find((seg) => seg.id === segmentId)
    if (movedSeg) {
      targetSegments.splice(clamped, 0, movedSeg)
    }
    if (newSectionId) {
      void reorderSegments(room.id, newSectionId, targetSegments.map((seg) => seg.id))
    } else {
      // For unsectioned, manually update order on each segment
      const now = Date.now()
      targetSegments.forEach((seg, idx) => {
        void updateSegment(room.id, seg.id, { order: (idx + 1) * 10, updatedAt: now } as Partial<Omit<SegmentType, 'id' | 'roomId'>>)
      })
    }

    // Normalize source section's segment ordering
    const sourceKey = fromSectionId === '__none__' ? undefined : fromSectionId
    const sourceSegments = segments
      .filter((seg) => seg.sectionId === sourceKey && seg.id !== segmentId)
      .sort((a, b) => a.order - b.order)
    if (sourceKey) {
      void reorderSegments(room.id, sourceKey, sourceSegments.map((seg) => seg.id))
    } else {
      const now = Date.now()
      sourceSegments.forEach((seg, idx) => {
        void updateSegment(room.id, seg.id, { order: (idx + 1) * 10, updatedAt: now } as Partial<Omit<SegmentType, 'id' | 'roomId'>>)
      })
    }
  }

  const handleMoveTimerToSegment = (timerId: string, fromSegmentId: string, targetSegmentId: string, targetIndex: number) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('reorder')
    if (fromSegmentId === targetSegmentId) return
    const now = Date.now()
    const targetIsSection = targetSegmentId.startsWith('__section__')
    const fromIsSection = fromSegmentId.startsWith('__section__')
    const targetSectionId = targetIsSection ? targetSegmentId.slice('__section__'.length) : null
    const fromSectionId = fromIsSection ? fromSegmentId.slice('__section__'.length) : null
    // Use null (not undefined) so updateTimer actually clears the field
    const newSegmentId: string | null = targetIsSection ? null : targetSegmentId === '__none__' ? null : targetSegmentId
    const fromSegId: string | null = fromIsSection ? null : fromSegmentId === '__none__' ? null : fromSegmentId

    // --- Target segment: insert and reorder ---
    const targetTimers = timers
      .filter((timer) => {
        if (targetIsSection) {
          return timer.sectionId === targetSectionId && !timer.segmentId && timer.id !== timerId
        }
        return (timer.segmentId ?? '__none__') === targetSegmentId && timer.id !== timerId
      })
      .sort((a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order))
    const clamped = Math.max(0, Math.min(targetIndex, targetTimers.length))
    const movedTimer = timers.find((timer) => timer.id === timerId)
    if (movedTimer) {
      targetTimers.splice(clamped, 0, movedTimer)
    }
    targetTimers.forEach((timer, idx) => {
      const patch: Record<string, unknown> = { segmentOrder: idx * 10, updatedAt: now }
      if (timer.id === timerId) {
        patch.segmentId = newSegmentId
        patch.sectionId = targetIsSection ? targetSectionId : null
      }
      void updateTimer(room.id, timer.id, patch as Partial<Omit<TimerType, 'id' | 'roomId'>>)
    })

    // --- Source segment: reorder remaining timers ---
    const sourceTimers = timers
      .filter((timer) => {
        if (fromIsSection) {
          return timer.sectionId === fromSectionId && !timer.segmentId && timer.id !== timerId
        }
        return (timer.segmentId ?? '__none__') === fromSegmentId && timer.id !== timerId
      })
      .sort((a, b) => (a.segmentOrder ?? a.order) - (b.segmentOrder ?? b.order))
    sourceTimers.forEach((timer, idx) => {
      void updateTimer(room.id, timer.id, { segmentOrder: idx * 10, updatedAt: now } as Partial<Omit<TimerType, 'id' | 'roomId'>>)
    })

    // --- primaryTimerId maintenance ---
    // If target segment was empty, set primaryTimerId to the moved timer
    if (!targetIsSection && newSegmentId) {
      const targetWasEmpty = timers.filter(
        (timer) => timer.segmentId === newSegmentId && timer.id !== timerId,
      ).length === 0
      if (targetWasEmpty) {
        void updateSegment(room.id, newSegmentId, { primaryTimerId: timerId } as Partial<Omit<SegmentType, 'id' | 'roomId'>>)
      }
    }
    // If the moved timer was the primaryTimerId of the source segment, pick next or clear
    if (!fromIsSection && fromSegId) {
      const sourceSegment = segments.find((seg) => seg.id === fromSegId)
      if (sourceSegment?.primaryTimerId === timerId) {
        const nextPrimary = sourceTimers[0]?.id ?? null
        void updateSegment(room.id, fromSegId, { primaryTimerId: nextPrimary } as Partial<Omit<SegmentType, 'id' | 'roomId'>>)
      }
    }
  }

  const handleCreateCue = (input: {
    title: string
    role: 'lx' | 'ax' | 'vx' | 'sm' | 'foh' | 'custom'
    triggerType: 'timed' | 'fixed_time' | 'sequential' | 'follow' | 'floating'
    sectionId?: string
    segmentId?: string
    order?: number
    offsetMs?: number
    timeBase?: 'actual' | 'planned'
    targetTimeMs?: number
    afterCueId?: string
    approximatePosition?: number
    triggerNote?: string
    notes?: string
    createdByRole?: 'lx' | 'ax' | 'vx' | 'sm' | 'foh' | 'custom'
  }) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('create-cue')
    void createCue(room.id, input)
  }

  const handleUpdateCue = (
    cueId: string,
    patch: Partial<Omit<Cue, 'id' | 'roomId' | 'createdBy' | 'createdAt'>>,
  ) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('update-cue')
    void updateCue(room.id, cueId, patch)
  }

  const handleDeleteCue = (cueId: string) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('delete-cue')
    void deleteCue(room.id, cueId)
  }

  const handleReorderCues = (cueIds: string[]) => {
    if (isReadOnly || !room) return
    bumpCompanionOnActivity('reorder-cue')
    void reorderCues(room.id, cueIds)
  }

  const pendingStagedDelta = useRef(0)
  const stagedFlush = useRef<number | null>(null)
  const flushStaged = useCallback(() => {
    if (pendingStagedDelta.current === 0) return
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !selectedTimer) return
    const deltaMs = pendingStagedDelta.current
    pendingStagedDelta.current = 0
    if (deltaMs !== 0) {
      const nextDurationSec = Math.max(0, Math.round(selectedTimer.duration + deltaMs / 1000))
      void updateTimer(currentRoomId, selectedTimer.id, { duration: nextDurationSec })
    }
    if (stagedFlush.current) {
      window.clearTimeout(stagedFlush.current)
      stagedFlush.current = null
    }
  }, [currentRoomId, isReadOnly, selectedTimer, updateTimer])

  useEffect(() => {
    if (!currentRoomId) return
    let repeatInterval: number | null = null
    let repeatTimeout: number | null = null

    const stopRepeat = () => {
      if (repeatInterval) {
        window.clearInterval(repeatInterval)
        repeatInterval = null
      }
      if (repeatTimeout) {
        window.clearTimeout(repeatTimeout)
        repeatTimeout = null
      }
    }

    const performArrowAction = (direction: 'up' | 'down', deltaMs: number) => {
      const adjustSelected =
        shortcutScope === 'rundown' &&
        selectedTimer &&
        selectedTimer.id !== activeTimer?.id

      const signedDelta = direction === 'up' ? deltaMs : -deltaMs

      if (adjustSelected) {
        bumpCompanionOnActivity('nudge')
        pendingStagedDelta.current += signedDelta
        if (!stagedFlush.current) {
          stagedFlush.current = window.setTimeout(flushStaged, 100)
        }
        return
      }

      if (!currentRoomId || !room) return
      bumpCompanionOnActivity('nudge')
      if (room.state.isRunning) {
        void nudgeTimer(currentRoomId, signedDelta)
      } else if (activeTimer) {
        const nextDurationSec = Math.max(
          0,
          Math.round(activeTimer.duration + signedDelta / 1000),
        )
        void updateTimer(currentRoomId, activeTimer.id, { duration: nextDurationSec })
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'r') return

      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      switch (event.code) {
        case 'Space': {
          event.preventDefault()
          const activeId = room?.state.activeTimerId
          const targetId = shortcutScope === 'rundown' && selectedTimer ? selectedTimer.id : activeId
          if (!targetId) break

          const isActiveTarget = targetId === activeId
          if (isActiveTarget && isRunning) {
            void pauseTimer(currentRoomId)
          } else {
            void startTimer(currentRoomId, targetId)
          }
          break
        }
        case 'KeyR': {
          event.preventDefault()
          void resetTimer(currentRoomId)
          break
        }
        case 'Escape': {
          if (shortcutScope !== 'controls') {
            event.preventDefault()
            setShortcutScope('controls')
          }
          break
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (event.repeat) return
          const deltaMs = event.shiftKey
            ? 600_000
            : event.ctrlKey || event.metaKey
              ? 1_000
              : 60_000
          event.preventDefault()
          const direction = event.code === 'ArrowUp' ? 'up' : 'down'
          performArrowAction(direction, deltaMs)
          stopRepeat()
          repeatTimeout = window.setTimeout(() => {
            repeatInterval = window.setInterval(
              () => performArrowAction(direction, deltaMs),
              110,
            )
          }, 180)
          break
        }
        case 'BracketLeft': {
          event.preventDefault()
          handleStartPrevTimer()
          break
        }
        case 'BracketRight': {
          event.preventDefault()
          handleStartNextTimer()
          break
        }
        default:
          break
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        stopRepeat()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', stopRepeat)
    return () => {
      stopRepeat()
      flushStaged()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', stopRepeat)
    }
  }, [
    activeTimer,
    currentRoomId,
    isRunning,
    nudgeTimer,
    pauseTimer,
    resetTimer,
    selectedTimer,
    shortcutScope,
    room,
    startTimer,
    updateTimer,
    handleStartNextTimer,
    handleStartPrevTimer,
    flushStaged,
    bumpCompanionOnActivity,
  ])

  if (!room || !roomId) {
    return (
      <div className="rounded-2xl border border-slate-900 bg-slate-900/50 p-8 text-center text-slate-400">
        Room not found. Return to the dashboard.
      </div>
    )
  }

  const viewerUrl = getCloudViewerUrl(room.id)
  const lanViewerUrl = lanPairing?.urls?.[0] ?? ''

  const messageKey = `${room.state.message.text}::${room.state.message.color}::${room.state.message.visible}`

  return (
    <>
      {forcePromptOpen ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setForcePromptOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-rose-300">Force takeover</p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  {forcePromptMode === 'confirm' ? 'Confirm takeover' : 'Enter room PIN'}
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  {forcePromptMode === 'confirm'
                    ? 'This will displace the current controller.'
                    : 'Use the room PIN or leave blank to re-auth with Google.'}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white"
                onClick={() => setForcePromptOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {forcePromptMode === 'pin' ? (
              <div className="mt-5">
                <input
                  ref={forcePinInputRef}
                  type="password"
                  inputMode="numeric"
                  value={forcePinDraft}
                  onChange={(event) => setForcePinDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitForceTakeover()
                    }
                  }}
                  placeholder="PIN (4-8 digits)"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-rose-300/70"
                />
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setForcePromptOpen(false)}
                className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitForceTakeover()}
                disabled={forceTakeoverInFlight}
                className="rounded-full border border-rose-300/70 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200 disabled:opacity-60"
              >
                {forceTakeoverInFlight ? 'Requesting...' : 'Force takeover'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {handoverOpen ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setHandoverOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-rose-300">Hand over control</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Select target device</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Transfer control instantly to another controller in this room.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white"
                onClick={() => setHandoverOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="mt-5 grid gap-2">
              {availableHandoverTargets.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                  No other controllers connected.
                </div>
              ) : (
                availableHandoverTargets.map((client) => {
                  const sourceLabel =
                    client.sources.length > 1
                      ? 'Cloud+Companion'
                      : client.sources[0] === 'companion'
                        ? 'Companion'
                        : client.sources[0] === 'cloud'
                          ? 'Cloud'
                          : null
                  const presenceState = getClientPresenceState(
                    { lastHeartbeat: client.lastHeartbeat, source: client.preferredSource },
                    controlNow,
                  )
                  const presenceLabel = presenceState === 'idle' ? 'Idle' : null
                  const displayLabel = [client.displayName, sourceLabel, presenceLabel]
                    .filter(Boolean)
                    .join(' · ')
                  const selected = handoverTargetId === client.targetClientId
                  return (
                    <button
                      key={client.key}
                      type="button"
                      onClick={() => setHandoverTargetId(client.targetClientId)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        selected
                          ? 'border-rose-300/70 bg-rose-500/10 text-rose-100'
                          : 'border-slate-800 bg-slate-900/60 text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <span className="font-semibold">{displayLabel}</span>
                      {selected ? <span className="text-xs uppercase tracking-[0.2em]">Selected</span> : null}
                    </button>
                  )
                })
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setHandoverOpen(false)}
                className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmHandover}
                disabled={!handoverTargetId}
                className="rounded-full border border-rose-300/70 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200 disabled:opacity-60"
              >
                Hand over
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <section className="space-y-6">
        <header className={`rounded-3xl border p-4 shadow-card sm:p-6 ${simpleSurfaceTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Current Room
                </p>
                {isTitleEditing ? (
                  <input
                    ref={titleInputRef}
                    value={titleInput}
                    onChange={(event) => setTitleInput(event.target.value)}
                    onBlur={handleTitleSave}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleTitleSave()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setTitleInput(room.title)
                        setIsTitleEditing(false)
                      }
                    }}
                    className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1 text-lg font-semibold text-white"
                  />
                ) : (
                  <button
                    type="button"
                    className={`text-left text-2xl font-semibold text-white hover:text-emerald-200 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                    onClick={() => {
                      if (isReadOnly) {
                        setControlBarCollapsed(false)
                        return
                      }
                      setTitleInput(room.title)
                      setIsTitleEditing(true)
                    }}
                  >
                    {room.title}
                  </button>
                )}
                <p className="text-xs text-slate-500">
                  Created {formatDate(room.createdAt, room.timezone)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  Timezone
                </p>
                {isTimezoneEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      list={timezoneListId}
                      className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-white"
                      name="room-timezone"
                      ref={timezoneInputRef}
                      value={timezoneInput}
                      onChange={(event) => setTimezoneInput(event.target.value)}
                      onBlur={handleTimezoneSave}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleTimezoneSave()
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          setTimezoneInput(room.timezone)
                          setIsTimezoneEditing(false)
                        }
                      }}
                    />
                    <datalist id={timezoneListId}>
                      {timezoneOptions.map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={`inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 transition hover:border-emerald-400/60 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                      onClick={() => {
                        if (isReadOnly) {
                          setControlBarCollapsed(false)
                          return
                        }
                        setTimezoneInput(room.timezone)
                        setIsTimezoneEditing(true)
                      }}
                    >
                      {room.timezone}
                    </button>
                    <button
                      type="button"
                      className={`inline-flex items-center rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-emerald-400/60 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                      onClick={(event) => {
                        event.preventDefault()
                        if (isReadOnly) {
                          setControlBarCollapsed(false)
                          return
                        }
                        if (room) {
                          const next = (room.state.clockMode ?? '24h') === '24h' ? 'ampm' : '24h'
                          void setClockFormat(room.id, next)
                        }
                      }}
                      aria-label="Toggle 12/24 hour clock"
                    >
                      {(room?.state.clockMode ?? '24h') === '24h' ? '24h' : 'AM·PM'}
                    </button>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    Clock
                  </span>
                  <span className="text-xs text-slate-300">
                    {(room?.state.clockMode ?? '24h') === '24h' ? '24-hour' : 'AM/PM'}
                  </span>
                </div>
              </div>
            </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionIndicator status={connectionStatus} />
            {lockState !== 'authoritative' || isCloudOffline || viewerOnly ? (
              <button
                type="button"
                onClick={() => setControlBarCollapsed(false)}
                className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                {viewerOnly ? 'Viewer mode' : 'View only'}
              </button>
            ) : null}
            {roomAuthority?.status === 'syncing' ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
                <span className="h-2 w-2 rounded-full bg-sky-300 animate-pulse" />
                Sync
                </span>
              ) : null}
            {roomId && lockState === 'authoritative' ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                <span className="text-[9px] tracking-[0.2em] text-slate-400">PIN</span>
                {pinEditing ? (
                  <input
                    ref={pinInputRef}
                    value={pinDraft}
                    onChange={(event) => setPinDraft(event.target.value)}
                    onBlur={handleSavePin}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleSavePin()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        handleCancelPin()
                      }
                    }}
                    className="w-20 rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-100"
                    placeholder="1234"
                    inputMode="numeric"
                    autoFocus
                  />
                ) : canEditPin ? (
                  <button
                    type="button"
                    onClick={handleSetPin}
                    className="text-[11px] font-semibold text-slate-100 transition hover:text-white"
                  >
                    {roomPin ? (pinHidden ? '****' : roomPin) : 'Not set'}
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">{pinPermissionLabel}</span>
                )}
                {!pinEditing && roomPin && canEditPin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPinHidden((prev) => !prev)}
                      className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500"
                    >
                      {pinHidden ? 'Show' : 'Hide'}
                    </button>
                    {!pinHidden ? (
                      <button
                        type="button"
                        onClick={() => void handleCopyPin()}
                        className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-500"
                      >
                        Copy
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
              <Tooltip content="Undo timer delete (Cmd/Ctrl+Z)">
                <button
                  type="button"
                  onClick={() => {
                    if (isReadOnly) {
                      setControlBarCollapsed(false)
                      return
                    }
                    if (roomId) void undoTimerDelete(roomId)
                  }}
                  aria-disabled={isReadOnly}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-100 transition hover:border-emerald-500/60 hover:text-emerald-200 ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  ↺
                </button>
              </Tooltip>
              <Tooltip content="Redo timer delete (Shift+Cmd/Ctrl+Z)">
                <button
                  type="button"
                  onClick={() => {
                    if (isReadOnly) {
                      setControlBarCollapsed(false)
                      return
                    }
                    if (roomId) void redoTimerDelete(roomId)
                  }}
                  aria-disabled={isReadOnly}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-100 transition hover:border-emerald-500/60 hover:text-emerald-200 ${isReadOnly ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  ↻
                </button>
              </Tooltip>
              {roomId && lockState === 'authoritative' && controlsAllowed ? (
                <Tooltip content="Hand over control">
                  <button
                    type="button"
                    onClick={() => {
                      if (!handoverTargetId && availableHandoverTargets[0]) {
                        setHandoverTargetId(availableHandoverTargets[0].targetClientId)
                      }
                      setHandoverOpen(true)
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300"
                  >
                    Hand over
                  </button>
                </Tooltip>
              ) : null}
              <Tooltip content="Open Viewer in new tab">
                <a
                  href={`/room/${room.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:border-white/60"
                >
                  Viewer
                </a>
              </Tooltip>
            <ShareLinkButton roomId={room.id} />
          </div>
        </div>
        {showControlTier ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            {showControlUi ? (
              <>
                <div className="space-y-4">
                  <div className={`rounded-2xl border p-4 text-left ${simplePanelTone}`}>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Main timer</p>
                    <p className="text-sm font-semibold text-white">
                      {activeTimer ? activeTimer.title : 'Standby'}
                    </p>
                    <p className="mt-2 text-3xl font-semibold text-white">{mainDisplay}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                      {mainStatusLabel}
                    </p>
                  </div>
                  <div className={`rounded-2xl border p-4 text-left ${simplePanelTone}`}>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      PiP {pipLabel}
                    </p>
                    <p className="text-sm font-semibold text-white">
                      {pipTimer ? pipTimer.title : 'Standby'}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">{pipRemaining}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {pipTimer?.speaker ? `Speaker: ${pipTimer.speaker}` : 'Ready'}
                    </p>
                  </div>
                </div>
                {companionReady ? (
                  <PresentationStatusPanel
                    cue={activeLiveCue}
                    isCapabilityMissing={capabilityMissing}
                    isMacPlatform={Boolean(isMacPlatform)}
                  />
                ) : (
                  <div className={`rounded-2xl border p-4 text-left ${simplePanelTone}`}>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                      Presentation status
                    </p>
                    <p className="mt-2 text-sm font-semibold text-white">Companion required</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Connect Companion to track slides and video timing.
                    </p>
                    {canClearPresentation ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (room) clearLiveCues?.(room.id)
                        }}
                        className="mt-3 inline-flex items-center justify-center rounded-full border border-amber-300/60 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-200"
                      >
                        Clear presentation status
                      </button>
                    ) : null}
                  </div>
                )}
              </>
            ) : showControlBlocked ? (
              <div className="rounded-2xl border border-amber-800/50 bg-amber-950/40 p-4 text-left text-xs text-amber-200">
                <p className="font-semibold">
                  Feature unavailable in Minimal Mode — upgrade or restart Companion in Show Control mode.
                </p>
                <p className="mt-1 text-amber-100/80">
                  Show Control mode is required for the dual header.
                </p>
                <Link
                  to="/local"
                  className="mt-2 inline-flex rounded-full border border-amber-400/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-500/10"
                >
                  Learn more
                </Link>
              </div>
            ) : null}
          </div>
        ) : isBasicTier ? (
          <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/40 p-4 text-left">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Simple mode</p>
                  <span className="rounded-full border border-amber-300/60 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                    Upgrade
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-200">
                  Upgrade to unlock Show Control tools, presentation status, and PiP timers.
                </p>
              </div>
              <Link
                to="/"
                className="rounded-full border border-amber-300/60 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-200"
              >
                See plans
              </Link>
            </div>
          </div>
        ) : null}
        {showControlEnabled && presentationFeatureEnabled && powerpointMissing && !showControlBlocked ? (
          <div className="mt-4 rounded-2xl border border-amber-800/50 bg-amber-950/40 p-4 text-left text-xs text-amber-200">
            <p className="font-semibold">
              Feature unavailable in Minimal Mode — upgrade or restart Companion in Show Control mode.
            </p>
            <p className="mt-1 text-amber-100/80">
              Show Control mode is required for presentation import.
            </p>
            <Link
              to="/local"
              className="mt-2 inline-flex rounded-full border border-amber-400/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-500/10"
            >
              Learn more
            </Link>
          </div>
        ) : null}
        {showPresentationBanner ? (
          <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-200">
                  Presentation detected
                </p>
                <p className="text-sm font-semibold text-white">
                  {presentationCue?.metadata?.filename ??
                    lastPresentationEntry?.record.cue.metadata?.filename ??
                    presentationCue?.title ??
                    lastPresentationEntry?.record.cue.title ??
                    'PowerPoint presentation'}
                </p>
                <p className="text-xs text-emerald-100/80">
                  {lastPresentationDetectedAt
                    ? `Detected at ${formatDate(
                        lastPresentationDetectedAt,
                        room?.timezone ?? 'UTC',
                      )}`
                    : 'Ready to import slides and video cues.'}
                </p>
                {presentationDuplicatesHidden > 0 ? (
                  <p className="mt-1 text-[10px] text-emerald-100/70">
                    Deduped {presentationDuplicatesHidden} duplicate updates.
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPresentationImportOpen(true)}
                  className="rounded-full border border-emerald-200/60 bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-50 transition hover:border-emerald-100"
                >
                  Import
                </button>
                <button
                  type="button"
                  onClick={handleDismissPresentationBanner}
                  className="rounded-full border border-emerald-200/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showControlEnabled &&
        presentationFeatureEnabled &&
        presentationImportOpen &&
        presentationEntries.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-left">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Presentation import
                </p>
                <p className="text-xs text-slate-300">
                  Map detected video moments to cues. Changes are stored locally in this session.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPresentationImportOpen(false)}
                className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                Close
              </button>
            </div>
            {isMacPlatform ? (
              <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
                Video timing is unavailable on macOS. Imports still work without timing metadata.
              </div>
            ) : presentationTimingWarning ? (
              <div className="mt-3 rounded-xl border border-amber-800/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
                Video metadata unavailable (ffprobe missing or unsupported). Continue without timing data.
              </div>
            ) : null}
            <div className="mt-3 space-y-3">
              {presentationEntries.map((entry) => {
                const mapping = presentationMappings[entry.key] ?? {
                  targetId: 'unassigned',
                  customLabel: '',
                }
                const slideLabel = (() => {
                  const slideNumber = entry.record.cue.metadata?.slideNumber
                  const totalSlides = entry.record.cue.metadata?.totalSlides
                  if (slideNumber === undefined && totalSlides === undefined) return 'Slide data unavailable'
                  return `Slide ${slideNumber ?? '--'} / ${totalSlides ?? '--'}`
                })()
                return (
                  <div
                    key={entry.key}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {entry.record.cue.metadata?.filename ??
                            entry.record.cue.title ??
                            'Presentation'}
                        </p>
                        <p className="text-xs text-slate-400">{slideLabel}</p>
                      </div>
                      {entry.duplicateCount > 1 ? (
                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                          {entry.duplicateCount} updates
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div>
                        <label className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                          Cue mapping
                        </label>
                        <select
                          value={mapping.targetId}
                          onChange={(event) => {
                            const nextTarget = event.target.value
                            updatePresentationMapping(entry.key, {
                              targetId: nextTarget,
                              customLabel: nextTarget === 'custom' ? mapping.customLabel : '',
                            })
                          }}
                          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-2 text-xs text-slate-200"
                        >
                          <option value="unassigned">Unassigned</option>
                          <option value="custom">Custom cue label</option>
                          {presentationMappingOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                          Cue label
                        </label>
                        <input
                          type="text"
                          value={
                            mapping.targetId === 'custom'
                              ? mapping.customLabel
                              : mapping.targetId === 'unassigned'
                              ? ''
                              : presentationMappingOptions.find(
                                  (option) => option.value === mapping.targetId,
                                )?.label ?? ''
                          }
                          onChange={(event) =>
                            updatePresentationMapping(entry.key, {
                              customLabel: event.target.value,
                              targetId: mapping.targetId === 'custom' ? 'custom' : mapping.targetId,
                            })
                          }
                          placeholder={
                            mapping.targetId === 'custom'
                              ? 'Enter cue label'
                              : mapping.targetId === 'unassigned'
                              ? 'Not mapped'
                              : undefined
                          }
                          disabled={mapping.targetId !== 'custom'}
                          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-2 text-xs text-slate-200 disabled:opacity-50"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[10px] text-slate-500">
              Mapping is local-only for now. No cues are created in this pass.
            </p>
            {debugCompanion ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Presentation debug
                </p>
                <div className="mt-2 grid gap-1 text-xs text-slate-400">
                  <span>liveCueRecords: {liveCueRecords.length}</span>
                  <span>presentationRecords: {presentationRecords.length}</span>
                  <span>presentationEntries: {presentationEntries.length}</span>
                  <span>activeLiveCueId: {activeLiveCueId ?? 'none'}</span>
                  <span>
                    slide: {presentationCue?.metadata?.slideNumber ?? '—'} /{' '}
                    {presentationCue?.metadata?.totalSlides ?? '—'}
                  </span>
                  <span>companionConnected: {String(companion.isConnected)}</span>
                  <span>handshakeStatus: {companion.handshakeStatus}</span>
                  <span>capabilityPowerPoint: {String(presentationCapability)}</span>
                  <span>featurePowerPoint: {String(presentationFeatureEnabled)}</span>
                  <span>showControlEnabled: {String(showControlEnabled)}</span>
                  <span>effectiveMode: {effectiveMode}</span>
                  {liveCueDiagnostics ? (
                    <>
                      <span>canUseLiveCues: {String(liveCueDiagnostics.canUseLiveCues)}</span>
                      <span>companionLive: {String(liveCueDiagnostics.isCompanionLive)}</span>
                      <span>companionSubscribed: {String(liveCueDiagnostics.isSubscribed)}</span>
                      <span>firebaseLiveCues: {liveCueDiagnostics.firebaseCount}</span>
                      <span>companionLiveCues: {liveCueDiagnostics.companionCount}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {showControlBar ? (
          <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-full border px-4 py-2 text-xs text-slate-100 shadow-sm ${
              controlBarTone === 'rose'
                ? 'border-rose-400/40 bg-rose-500/10'
                : 'border-amber-400/40 bg-amber-500/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-2 w-2 rounded-full ${
                  controlBarTone === 'rose' ? 'bg-rose-300' : 'bg-amber-300'
                } ${controlBarTone === 'amber' ? 'animate-pulse' : ''}`}
              />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-200">
                  {controlTitle}
                </p>
                <p className="text-[11px] text-slate-200/80">{controlDetail}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {lockState === 'requesting' && !displacement ? (
                <span className="text-[11px] text-slate-200/70">
                  {forceTakeoverReady
                    ? 'Take control now'
                    : requestCountdown
                    ? `Take control in ${requestCountdown}s`
                    : 'Waiting for response'}
                </span>
              ) : null}
              {!forceTakeoverReady && (
                <span className="text-[10px] text-slate-200/60">
                  Use PIN or re-auth to take control now.
                </span>
              )}
              {reauthHintActive ? (
                <span className="text-[10px] text-slate-200/70">
                  Re-auth failed. Close the pop-up if it stays open.
                </span>
              ) : null}
              {displacement ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (room && controlsAllowed) requestControl(room.id)
                      setControlBarCollapsed(false)
                    }}
                    disabled={!controlsAllowed || lockState === 'requesting'}
                    className="rounded-full border border-rose-300/70 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200 disabled:opacity-60"
                  >
                    {lockState === 'requesting' ? 'Requesting' : 'Reclaim'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForceTakeover}
                    disabled={!controlsAllowed || forceTakeoverInFlight || (!forceTakeoverReady && !canForceNow)}
                    className="rounded-full border border-rose-400/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300 disabled:opacity-60"
                  >
                    {forceTakeoverInFlight
                      ? 'Requesting...'
                      : forceTakeoverReady
                      ? 'Force'
                      : canForceNow
                      ? 'Force now'
                      : 'Force (PIN)'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDismissControlBar()
                    }}
                    className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
                  >
                    Dismiss
                  </button>
                </>
              ) : visibleDenial || visibleError ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDismissControlBar()
                    }}
                    className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
                  >
                    Dismiss
                  </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!controlsAllowed || lockState === 'requesting'}
                    onClick={() => room && controlsAllowed && requestControl(room.id)}
                    className="rounded-full border border-amber-300/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-200 disabled:opacity-60"
                  >
                    {lockState === 'requesting' ? 'Requesting' : 'Request'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForceTakeover}
                    disabled={!controlsAllowed || forceTakeoverInFlight || (!forceTakeoverReady && !canForceNow)}
                    title={
                      forceTakeoverReady
                        ? 'Force takeover now'
                        : canForceNow
                        ? 'Force takeover with PIN or re-auth'
                        : 'No PIN set; force takeover after timeout'
                    }
                    className="rounded-full border border-rose-400/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300 disabled:opacity-60"
                  >
                    {forceTakeoverInFlight
                      ? 'Requesting...'
                      : forceTakeoverReady
                      ? 'Force'
                      : canForceNow
                      ? 'Force now'
                      : 'Force (PIN)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewerOnly((prev) => !prev)}
                    className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
                  >
                    {viewerOnly ? 'Enable control' : 'Viewer-only'}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDismissControlBar()
                    }}
                    className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
                  >
                    Dismiss
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
        {roomId && lockState === 'authoritative' && incomingRequest && ignoredRequestTs !== incomingRequest.requestedAt ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-full border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-xs text-rose-100 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-rose-100">Control request</p>
                <p className="text-[11px] text-rose-100/90">
                  {incomingRequest.requesterUserName ?? incomingRequest.requesterName ?? 'Another device'} wants control.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!canHandOver || !controlsAllowed) return
                  if (room) handOverControl(room.id, incomingRequest.requesterId)
                }}
                disabled={!canHandOver || !controlsAllowed}
                title={
                  !controlsAllowed
                    ? 'Viewer-only mode blocks controller actions'
                    : canHandOver
                    ? undefined
                    : 'Handover requires Companion'
                }
                className="rounded-full border border-rose-300/70 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200 disabled:opacity-60"
              >
                Hand over
              </button>
              <button
                type="button"
                onClick={() => setRequestChimeEnabled((prev) => !prev)}
                className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                Chime {requestChimeEnabled ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!controlsAllowed) return
                  if (room) {
                    denyControl(room.id, incomingRequest.requesterId)
                  }
                  setIgnoredRequestTs(incomingRequest.requestedAt)
                }}
                disabled={!controlsAllowed}
                className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                Deny
              </button>
            </div>
          </div>
        ) : null}
        {connectionStatus !== 'online' && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle size={16} />
            {roomAuthority?.source === 'cloud' && !companionReady
              ? 'No cloud sync or Companion connection. Controls disabled.'
              : 'Cloud sync offline. Reconnect to make changes.'}
          </div>
          )}
        </header>

        <div
          className={`relative rounded-3xl border p-4 shadow-card transition ${isBasicTier ? 'bg-slate-900/50' : 'bg-slate-950/60'} ${shortcutScope === 'controls' ? 'border-emerald-400/70 shadow-[0_0_25px_rgba(16,185,129,0.25)]' : isBasicTier ? 'border-slate-800/60' : 'border-slate-900/60'
            } sm:flex sm:items-center sm:justify-between sm:gap-4`}
          role="group"
          onClick={() => {
            if (isReadOnly) {
              setControlBarCollapsed(false)
            }
            setShortcutScope('controls')
          }}
        >
          <div className="flex flex-wrap items-center gap-2 text-base text-white">
            <Tooltip content="Previous Timer" shortcut="[">
              <button
                type="button"
                onClick={handleStartPrevTimer}
                aria-disabled={isReadOnly}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={!prevTimer}
                aria-label="Previous timer (BracketLeft)"
              >
                <SkipBack size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Start Timer" shortcut="Space">
              <button
                type="button"
                onClick={() => {
                  startControlTimer()
                }}
                aria-disabled={isReadOnly}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl font-semibold shadow-sm transition disabled:opacity-40 ${room.state.isRunning
                  ? 'bg-rose-500/85 text-white shadow-[0_4px_16px_rgba(248,113,113,0.35)]'
                  : 'bg-emerald-500/95 text-slate-950 hover:bg-emerald-400 shadow-[0_4px_16px_rgba(16,185,129,0.35)]'
                  } ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={!controlTargetTimerId}
                aria-label="Play"
              >
                <Play size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Pause Timer" shortcut="Space">
              <button
                type="button"
                onClick={() => {
                  pauseControlTimer()
                }}
                aria-disabled={isReadOnly}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border font-semibold transition disabled:opacity-40 ${room.state.isRunning
                  ? 'border-rose-400/80 bg-rose-500/15 text-rose-100 hover:border-rose-200'
                  : 'border-indigo-300/70 bg-slate-900/90 text-indigo-100 hover:border-indigo-200'
                  } ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={!room.state.isRunning}
                aria-label="Pause"
              >
                <Pause size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Next Timer" shortcut="]">
              <button
                type="button"
                onClick={handleStartNextTimer}
                aria-disabled={isReadOnly}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-white transition hover:border-emerald-200/70 disabled:opacity-30 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={!nextTimer}
                aria-label="Next timer (BracketRight)"
              >
                <SkipForward size={20} />
              </button>
            </Tooltip>
            <Tooltip content="Reset Timer" shortcut="R">
              <button
                type="button"
                onClick={() => {
                  resetControlTimer()
                }}
                aria-disabled={isReadOnly}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/70 bg-slate-900/80 text-amber-100 transition hover:border-amber-200 disabled:opacity-40 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={!controlTargetTimerId}
                aria-label="Reset timer"
              >
                <RotateCcw size={20} />
              </button>
            </Tooltip>
            {shortcutScope === 'controls' && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-100">
                Selected
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:mt-0">
            <span className="text-xs font-semibold text-slate-300">
              {activeIndex >= 0 ? activeIndex + 1 : 0} / {timers.length}
            </span>
            <Tooltip content={room.state.showClock ? 'Hide big clock' : 'Show big clock'}>
              <button
                type="button"
                onClick={handleToggleClock}
                aria-disabled={isReadOnly}
                className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition ${room.state.showClock
                  ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                  : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
                  } disabled:opacity-50 ${isReadOnly ? 'cursor-not-allowed' : ''}`}
                disabled={false}
                aria-label={room.state.showClock ? 'Hide clock' : 'Show clock'}
              >
                <Clock3 size={18} />
                {room.state.showClock ? 'Hide Clock' : 'Show Clock'}
              </button>
            </Tooltip>
            <div className="relative flex items-center gap-2">
              <Tooltip content="Share Viewer Link">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleShare()
                  }}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-white/50"
                  aria-label="Share"
                >
                  <Share2 size={20} />
                </button>
              </Tooltip>
              <Tooltip content={companionReady ? 'Share LAN viewer' : 'Connect Companion to share LAN viewer'}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setLanModalOpen(true)
                  }}
                  disabled={!companionReady}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-slate-200 transition hover:border-white/50 disabled:cursor-not-allowed disabled:opacity-40`}
                  aria-label="Share LAN viewer"
                >
                  <Wifi size={20} />
                </button>
              </Tooltip>
              <Tooltip content="Show QR Code">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setQrError(false)
                    setQrOpen((prev) => !prev)
                  }}
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border px-3 font-semibold transition ${qrOpen
                    ? 'border-emerald-400/70 text-emerald-200'
                    : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/50'
                    }`}
                  aria-label="Toggle QR code"
                >
                  <QrCode size={20} />
                </button>
              </Tooltip>
              {qrOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20 bg-transparent"
                    onClick={(event) => {
                      event.stopPropagation()
                      setQrOpen(false)
                      setQrModalOpen(false)
                    }}
                  />
                  <div
                    className="absolute right-0 top-full z-30 mt-2 flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-lg"
                    style={{ width: 320, height: 320, minWidth: 320, minHeight: 320 }}
                  >
                    {viewerUrl ? (
                      qrError ? (
                        <p className="text-xs text-slate-400">
                          QR code unavailable. Copy the link instead.
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="h-72 w-72"
                          onClick={() => setQrModalOpen(true)}
                          aria-label="Open QR code"
                        >
                          <LocalQrCode
                            value={viewerUrl}
                            size={320}
                            className="h-72 w-72 cursor-pointer object-contain"
                            onError={() => setQrError(true)}
                          />
                        </button>
                      )
                    ) : (
                      <p className="text-xs text-slate-400">QR available once the app loads.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {qrModalOpen && viewerUrl && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4"
            onClick={() => setQrModalOpen(false)}
          >
            <div
            className="rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {qrError ? (
              <p className="text-xs text-slate-400">QR code unavailable. Copy the link instead.</p>
            ) : (
              <div className="h-80 w-80">
                <LocalQrCode
                  value={viewerUrl}
                  size={320}
                  className="h-80 w-80 object-contain"
                  onError={() => setQrError(true)}
                />
              </div>
            )}
              <button
                type="button"
                className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60"
                onClick={() => setQrModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}
        {lanModalOpen && (
          <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 px-4"
            onClick={() => setLanModalOpen(false)}
          >
            <div
              className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">LAN Viewers</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">Local network viewer</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Share this link and pairing code with LAN viewers.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white"
                  onClick={() => setLanModalOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {!companionReady ? (
                <div className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  Connect Companion to enable LAN viewers.
                </div>
              ) : lanPairingLoading ? (
                <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                  Generating LAN pairing info...
                </div>
              ) : lanPairingError ? (
                <div className="mt-5 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {lanPairingError}
                </div>
              ) : (
                <>
                  <div className="mt-5 space-y-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">LAN URL</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="flex-1 truncate text-slate-200">{lanViewerUrl || 'Unavailable'}</span>
                        {lanViewerUrl ? (
                          <button
                            type="button"
                            className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/60"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(lanViewerUrl)
                              } catch {
                                window.prompt('Copy LAN viewer link', lanViewerUrl)
                              }
                            }}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Pairing code</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="text-lg font-semibold tracking-[0.3em] text-white">
                          {lanPairing?.code ?? '----'}
                        </span>
                        <span className="text-xs text-slate-400">
                          Expires {formatLanTime(lanPairing?.expiresAt)}
                        </span>
                        {lanPairing?.code ? (
                          <button
                            type="button"
                            className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/60"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(lanPairing.code)
                              } catch {
                                window.prompt('Copy pairing code', lanPairing.code)
                              }
                            }}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60"
                        onClick={() => void refreshLanPairingCode()}
                      >
                        Refresh code
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/60"
                        onClick={() => void refreshLanStatus()}
                      >
                        Refresh devices
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-rose-400/70 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-200"
                        onClick={() => void handleResetLanViewers()}
                      >
                        Reset viewers
                      </button>
                    </div>
                    {lanViewerUrl ? (
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-center">
                        <div className="mx-auto h-56 w-56">
                          <LocalQrCode value={lanViewerUrl} size={240} className="h-56 w-56 object-contain" />
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          QR encodes the LAN URL and pairing code.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Paired devices
                    </p>
                    <div className="mt-2 space-y-2">
                      {lanPairingStatus?.tokens?.length ? (
                        lanPairingStatus.tokens.map((entry) => (
                          <div
                            key={entry.tokenId}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200"
                          >
                            <div>
                              <p className="font-semibold">
                                {entry.deviceName ?? 'Viewer device'}
                              </p>
                              <p className="text-xs text-slate-400">
                                {entry.role ? entry.role.toUpperCase() : 'ALL'} · Expires {formatLanTime(entry.expiresAt)}
                              </p>
                            </div>
                            {entry.revokedAt ? (
                              <span className="text-xs uppercase tracking-[0.2em] text-rose-300">Revoked</span>
                            ) : (
                              <button
                                type="button"
                                className="rounded-full border border-rose-400/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-200"
                                onClick={() => void handleRevokeLanViewer(entry.tokenId)}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                          No paired viewers yet.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <RundownPanel
            readOnly={isReadOnly}
            timers={timers}
            sections={sections}
            segments={segments}
            activeTimerId={room.state.activeTimerId}
            isRunning={isRunning}
            activeTimerDisplay={isRunning && activeTimer ? engine.display : null}
            remainingLookup={remainingLookup}
            selectedTimerId={selectedTimerId}
            showSelection={shortcutScope === 'rundown'}
            onSelect={(timerId) => {
              if (isReadOnly) {
                setControlBarCollapsed(false)
              }
              setSelectedTimerId(timerId)
              setShortcutScope('rundown')
            }}
            onStart={(timerId) => {
              if (isReadOnly) {
                setControlBarCollapsed(false)
                return
              }
              setSelectedTimerId(timerId)
              setShortcutScope('rundown')
              bumpCompanionOnActivity('start')
              void startTimer(room.id, timerId)
            }}
            onDeleteTimer={handleDeleteTimer}
            onAddTimer={handleAddTimer}
            onEditTimer={(timerId, patch) => {
              handleEditTimer(timerId, patch)
            }}
            onReorderTimers={(timerId, targetIndex) => {
              handleReorderTimer(timerId, targetIndex)
            }}
            onReorderSegmentTimers={handleReorderSegmentTimers}
            onAddSection={handleAddSection}
            onEditSection={handleEditSection}
            onDeleteSection={handleDeleteSection}
            onReorderSections={handleReorderSections}
            onAddSegment={handleAddSegment}
            onEditSegment={handleEditSegment}
            onDeleteSegment={handleDeleteSegment}
            onReorderSegments={handleReorderSegments}
            onMoveSegmentToSection={handleMoveSegmentToSection}
            onMoveTimerToSegment={handleMoveTimerToSegment}
            onPauseActive={pauseControlTimer}
            onActiveNudge={nudgeActiveTimer}
            onReset={handleResetTimer}
            undoPlaceholder={undoPlaceholder}
            onUndoDelete={roomId ? () => void undoTimerDelete(roomId) : undefined}
          />

          <div className="space-y-4">
            <MessagePanel
              key={messageKey}
              initial={room.state.message}
              disabled={isReadOnly}
              onBlocked={() => setControlBarCollapsed(false)}
              onUpdate={(payload) => {
                if (isReadOnly) {
                  setControlBarCollapsed(false)
                  return
                }
                void updateMessage(room.id, payload)
              }}
            />
            <LiveTimerPreview
              timer={activeTimer}
              readOnly={isReadOnly}
              showClock={room.state.showClock}
              engine={engine}
              isRunning={isRunning}
              onStart={startControlTimer}
              onPause={pauseControlTimer}
              onReset={resetControlTimer}
              onNudge={nudgeActiveTimer}
              onToggleClock={handleToggleClock}
              clockMode={room.state.clockMode ?? '24h'}
              message={room.state.message}
              timezone={room.timezone}
            />
            <CuesPanel
              roomId={room.id}
              cues={cues}
              sections={sections}
              segments={segments}
              readOnly={isReadOnly}
              isOwner={isOwner}
              currentUserId={user?.uid ?? null}
              onCreateCue={handleCreateCue}
              onUpdateCue={handleUpdateCue}
              onDeleteCue={handleDeleteCue}
              onReorderCues={handleReorderCues}
            />
          </div>
        </div>
      </section>
    </>
  )
}
