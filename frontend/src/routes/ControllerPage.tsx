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
} from 'lucide-react'
import { useDataContext } from '../context/DataProvider'
import { useAuth } from '../context/AuthContext'
import { RundownPanel } from '../components/controller/RundownPanel'
import { MessagePanel } from '../components/controller/MessagePanel'
import { LiveTimerPreview } from '../components/controller/LiveTimerPreview'
import { PresentationStatusPanel } from '../components/controller/PresentationStatusPanel'
import { useTimerEngine } from '../hooks/useTimerEngine'
import { ShareLinkButton } from '../components/core/ShareLinkButton'
import { ConnectionIndicator } from '../components/core/ConnectionIndicator'
import { Tooltip } from '../components/core/Tooltip'
import { formatDate, formatDuration } from '../lib/time'
import { getAllTimezones } from '../lib/timezones'
import { getCloudViewerUrl } from '../lib/viewer-links'
import { useAppMode } from '../context/AppModeContext'
import { useCompanionConnection } from '../context/CompanionConnectionContext'
import { useClock } from '../hooks/useClock'
import { auth } from '../lib/firebase'
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import type { LiveCueRecord } from '../types'

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
  } = ctx
  const subscribeToCompanionRoom = (ctx as typeof ctx & {
    subscribeToCompanionRoom?: (roomId: string, clientType: 'controller' | 'viewer') => void
  }).subscribeToCompanionRoom
  const lastJoinKeyRef = useRef<string | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const debugCompanion =
    typeof import.meta !== 'undefined' &&
    ((import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_DEBUG_COMPANION === 'true')

  const ensureCompanionJoin = useCallback(
    (options?: { force?: boolean; reason?: string }) => {
      if (!roomId) return
      if (!subscribeToCompanionRoom) return
      const joinKey = `${roomId}::controller::${effectiveMode}`
      if (!options?.force && lastJoinKeyRef.current === joinKey) return
      lastJoinKeyRef.current = joinKey
      if (debugCompanion) {
        console.info(
          `[Companion] auto-joining controller for room ${roomId} (${effectiveMode}) reason=${options?.reason ?? 'auto'}`,
        )
      }
      subscribeToCompanionRoom(roomId, 'controller')
    },
    [debugCompanion, effectiveMode, roomId, subscribeToCompanionRoom],
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
  const controllerLock = roomId ? getControllerLock(roomId) : null
  const lockState = roomId ? getControllerLockState(roomId) : 'authoritative'
  const isReadOnly = lockState !== 'authoritative'
  const roomPin = roomId ? getRoomPin(roomId) : null
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
  const forcePinInputRef = useRef<HTMLInputElement | null>(null)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [handoverTargetId, setHandoverTargetId] = useState<string | null>(null)
  const [viewerOnly, setViewerOnly] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ontime:viewerOnly') === 'true'
  })
  const [pinHidden, setPinHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ontime:pinHidden') === 'true'
  })
  const [pinEditing, setPinEditing] = useState(false)
  const [pinDraft, setPinDraft] = useState(roomPin ?? '')
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
      roomClientList.filter(
        (client) => client.clientType === 'controller' && client.clientId !== controllerLock?.clientId,
      ),
    [controllerLock?.clientId, roomClientList],
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
      lockState !== 'authoritative' &&
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
    if (lockState !== 'authoritative') return
    if (!sendHeartbeat) return
    const beat = () => sendHeartbeat(roomId)
    beat()
    const id = window.setInterval(beat, 30_000)
    return () => window.clearInterval(id)
  }, [lockState, roomId, sendHeartbeat])

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
    bumpCompanionOnActivity('play')
    void startTimer(currentRoomId, controlTargetTimerId)
  }

  const pauseControlTimer = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!currentRoomId || !controlTargetTimerId) return
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

  const handleForceTakeover = useCallback(() => {
    if (!room) return
    setForcePromptMode(forceTakeoverReady ? 'confirm' : 'pin')
    setForcePinDraft('')
    setForcePromptOpen(true)
  }, [forceTakeoverReady, room])

  useEffect(() => {
    if (!forcePromptOpen || forcePromptMode !== 'pin') return
    const id = window.setTimeout(() => forcePinInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [forcePromptOpen, forcePromptMode])

  const submitForceTakeover = useCallback(async () => {
    if (!room) return
    if (forcePromptMode === 'confirm') {
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
      forceTakeover(room.id, { pin: normalized })
      setForcePromptOpen(false)
      return
    }
    const ok = await attemptReauth()
    if (!ok) return
    forceTakeover(room.id, { reauthenticated: true })
    setForcePromptOpen(false)
  }, [attemptReauth, forcePinDraft, forcePromptMode, forceTakeover, normalizePin, room])

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
    if (!room || !handoverTargetId) return
    const target = roomClientList.find((client) => client.clientId === handoverTargetId)
    if (!target) return
    const targetLabel =
      target.userName && target.deviceName
        ? `${target.userName} · ${target.deviceName}`
        : target.userName ?? target.deviceName ?? 'another device'
    const prompt =
      target.userId && controllerLock?.userId && target.userId !== controllerLock.userId
        ? `Transfer control to ${target.userName ?? targetLabel}? They will have full control.`
        : `Hand over control to ${targetLabel}?`
    if (!window.confirm(prompt)) return
    handOverControl(room.id, target.clientId)
    setHandoverOpen(false)
    setHandoverTargetId(null)
  }, [controllerLock?.userId, handOverControl, handoverTargetId, room, roomClientList])

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

  const handleAddSegment = () => {
    if (isReadOnly) {
      setControlBarCollapsed(false)
      return
    }
    if (!room) return
    void createTimer(room.id, {
      title: 'New Segment',
      duration: 5 * 60,
      speaker: '',
    }).then((newTimer) => {
      if (!newTimer) return
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
    let repeatInterval: ReturnType<typeof window.setInterval> | null = null
    let repeatTimeout: ReturnType<typeof window.setTimeout> | null = null

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
                className="rounded-full border border-rose-300/70 bg-rose-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200"
              >
                Force takeover
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
                  const label =
                    client.userName && client.deviceName
                      ? `${client.userName} · ${client.deviceName}`
                      : client.userName ?? client.deviceName ?? 'Controller'
                  const selected = handoverTargetId === client.clientId
                  return (
                    <button
                      key={client.clientId}
                      type="button"
                      onClick={() => setHandoverTargetId(client.clientId)}
                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        selected
                          ? 'border-rose-300/70 bg-rose-500/10 text-rose-100'
                          : 'border-slate-800 bg-slate-900/60 text-slate-200 hover:border-slate-600'
                      }`}
                    >
                      <span className="font-semibold">{label}</span>
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
            {lockState !== 'authoritative' ? (
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
              {roomId && lockState === 'authoritative' && availableHandoverTargets.length > 0 ? (
                <Tooltip content="Hand over control">
                  <button
                    type="button"
                    onClick={() => {
                      if (!handoverTargetId && availableHandoverTargets[0]) {
                        setHandoverTargetId(availableHandoverTargets[0].clientId)
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
                <PresentationStatusPanel
                  cue={activeLiveCue}
                  isCapabilityMissing={capabilityMissing}
                  isMacPlatform={Boolean(isMacPlatform)}
                />
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
              {lockState === 'requesting' && !viewerOnly && !displacement ? (
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
                      if (room) requestControl(room.id)
                      setControlBarCollapsed(false)
                    }}
                    disabled={lockState === 'requesting'}
                    className="rounded-full border border-rose-300/70 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200 disabled:opacity-60"
                  >
                    {lockState === 'requesting' ? 'Requesting' : 'Reclaim'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForceTakeover}
                    disabled={!forceTakeoverReady && !canForceNow}
                    className="rounded-full border border-rose-400/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300 disabled:opacity-60"
                  >
                    {forceTakeoverReady ? 'Force' : canForceNow ? 'Force now' : 'Force (PIN)'}
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
                    disabled={lockState === 'requesting'}
                    onClick={() => room && requestControl(room.id)}
                    className="rounded-full border border-amber-300/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-200 disabled:opacity-60"
                  >
                    {lockState === 'requesting' ? 'Requesting' : 'Request'}
                  </button>
                  <button
                    type="button"
                    onClick={handleForceTakeover}
                    disabled={!forceTakeoverReady && !canForceNow}
                    title={
                      forceTakeoverReady
                        ? 'Force takeover now'
                        : canForceNow
                        ? 'Force takeover with PIN or re-auth'
                        : 'No PIN set; force takeover after timeout'
                    }
                    className="rounded-full border border-rose-400/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300 disabled:opacity-60"
                  >
                    {forceTakeoverReady ? 'Force' : canForceNow ? 'Force now' : 'Force (PIN)'}
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
                onClick={() => room && handOverControl(room.id, incomingRequest.requesterId)}
                className="rounded-full border border-rose-300/70 bg-rose-500/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-50 transition hover:border-rose-200"
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
                  if (room) {
                    denyControl(room.id, incomingRequest.requesterId)
                  }
                  setIgnoredRequestTs(incomingRequest.requestedAt)
                }}
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
            Demo latency enabled. Actions may take a moment.
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
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                            viewerUrl,
                          )}`}
                          alt="Viewer QR"
                          className="h-72 w-72 cursor-pointer object-contain"
                          onError={() => setQrError(true)}
                          onClick={() => setQrModalOpen(true)}
                        />
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
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(
                viewerUrl,
              )}`}
              alt="Viewer QR"
              className="h-80 w-80 object-contain"
              onError={() => setQrError(true)}
            />
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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <RundownPanel
            readOnly={isReadOnly}
            timers={timers}
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
            onDelete={handleDeleteTimer}
            onAddSegment={handleAddSegment}
            onEdit={(timerId, patch) => {
              handleEditTimer(timerId, patch)
            }}
            onReorder={(timerId, targetIndex) => {
              handleReorderTimer(timerId, targetIndex)
            }}
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
          </div>
        </div>
      </section>
    </>
  )
}
