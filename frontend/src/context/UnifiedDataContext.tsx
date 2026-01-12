/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { deleteDoc, deleteField, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import type { Room, Timer, LiveCue, LiveCueRecord, ControllerLock, ControllerLockState, ControllerClient } from '../types'
import { db } from '../lib/firebase'
import { DataProviderBoundary, useDataContext, type DataContextValue } from './DataContext'
import {
  computeElapsed,
  computeCompanionElapsed as computeCompanionElapsedUtil,
  resolveTimerElapsed,
  mergeProgress,
} from '../utils/timer-utils'
import { FirebaseDataProvider } from './FirebaseDataContext'
import { useAppMode } from './AppModeContext'
import { useAuth } from './AuthContext'
import { INTERFACE_VERSION, useCompanionConnection } from './CompanionConnectionContext'

type RoomAuthority = {
  source: 'cloud' | 'companion' | 'pending'
  status: 'ready' | 'syncing' | 'degraded'
  lastSyncAt: number
}

type CompanionRoomState = {
  activeTimerId: string | null
  isRunning: boolean
  currentTime: number
  lastUpdate: number
  activeLiveCueId?: string
}

type UnifiedDataContextValue = DataContextValue & {
  roomAuthority: Record<string, RoomAuthority>
  getRoomAuthority: (roomId: string) => RoomAuthority
  forceCloudAuthority: (roomId: string) => void
  forceCompanionAuthority: (roomId: string) => void
  subscribeToCompanionRoom: (
    roomId: string,
    clientType: 'controller' | 'viewer',
    tokenOverride?: string,
  ) => void
  unsubscribeFromCompanionRoom: (roomId: string) => void
}

type RoomStateSnapshotPayload = {
  type: 'ROOM_STATE_SNAPSHOT'
  roomId: string
  state: CompanionRoomState
  timestamp: number
}

type RoomStateDeltaPayload = {
  type: 'ROOM_STATE_DELTA'
  roomId: string
  changes: Partial<CompanionRoomState>
  clientId?: string
  timestamp: number
}

type RoomStatePatchPayload = {
  type: 'ROOM_STATE_PATCH'
  roomId: string
  changes: Partial<CompanionRoomState>
  clientId: string
  timestamp: number
}

type LiveCueEventPayload = {
  type: 'LIVE_CUE_CREATED' | 'LIVE_CUE_UPDATED' | 'LIVE_CUE_ENDED'
  roomId: string
  cue: LiveCue
  timestamp?: number
}

type PresentationEventPayload = {
  type: 'PRESENTATION_LOADED' | 'PRESENTATION_UPDATE'
  roomId: string
  cue: LiveCue
  timestamp?: number
}

export const resolveControllerLockState = ({
  roomId,
  clientId,
  controllerLocks,
  controlDisplacements,
  pendingControlRequests,
}: {
  roomId: string
  clientId: string
  controllerLocks: Record<string, ControllerLock | null | undefined>
  controlDisplacements: Record<string, { takenAt: number } | null | undefined>
  pendingControlRequests: Record<string, { requesterId: string } | null | undefined>
}): ControllerLockState => {
  if (controlDisplacements[roomId]) return 'displaced'
  const lock = controllerLocks[roomId]
  if (!lock) return 'authoritative'
  if (lock.clientId === clientId) return 'authoritative'
  const pending = pendingControlRequests[roomId]
  if (pending?.requesterId === clientId) return 'requesting'
  return 'read-only'
}

type TimerCreatedPayload = {
  type: 'TIMER_CREATED'
  roomId: string
  timer: Timer
  clientId?: string
  timestamp: number
}

type TimerUpdatedPayload = {
  type: 'TIMER_UPDATED'
  roomId: string
  timerId: string
  changes: Partial<Timer>
  clientId?: string
  timestamp: number
}

type TimerDeletedPayload = {
  type: 'TIMER_DELETED'
  roomId: string
  timerId: string
  clientId?: string
  timestamp: number
}

type TimersReorderedPayload = {
  type: 'TIMERS_REORDERED'
  roomId: string
  timerIds: string[]
  clientId?: string
  timestamp: number
}

type SyncRoomStatePayload = {
  type: 'SYNC_ROOM_STATE'
  roomId: string
  timers?: Timer[]
  state: {
    activeTimerId: string | null
    isRunning: boolean
    currentTime: number
    lastUpdate: number
  }
  sourceClientId?: string
  timestamp?: number
}

type HandshakeError = {
  type: 'HANDSHAKE_ERROR'
  code?: string
  message?: string
}

type ControllerLockStatePayload = {
  type: 'CONTROLLER_LOCK_STATE'
  roomId: string
  lock: ControllerLock | null
  timestamp: number
}

type ControlRequestReceivedPayload = {
  type: 'CONTROL_REQUEST_RECEIVED'
  roomId: string
  requesterId: string
  requesterName?: string
  requesterUserId?: string
  requesterUserName?: string
  timestamp: number
}

type ControlRequestDeniedPayload = {
  type: 'CONTROL_REQUEST_DENIED'
  roomId: string
  requesterId: string
  timestamp: number
  reason?: string
  deniedByName?: string
  deniedByUserId?: string
  deniedByUserName?: string
}

type RoomPinStatePayload = {
  type: 'ROOM_PIN_STATE'
  roomId: string
  pin: string | null
  updatedAt: number
}

type RoomClientsStatePayload = {
  type: 'ROOM_CLIENTS_STATE'
  roomId: string
  clients: ControllerClient[]
  timestamp: number
}

type ErrorPayload = {
  type: 'ERROR'
  code?: string
  message?: string
  roomId?: string
}

type ControlSyncPayload =
  | ControllerLockStatePayload
  | ControlRequestReceivedPayload
  | ControlRequestDeniedPayload
  | RoomPinStatePayload
  | RoomClientsStatePayload
  | ErrorPayload

type ControlSyncMessage = {
  sourceClientId: string
  payload: ControlSyncPayload
}

type ControlRequest = {
  requesterId: string
  requesterName?: string
  requesterUserId?: string
  requesterUserName?: string
  requestedAt: number
}

type ControlDenial = {
  requesterId: string
  reason?: string
  deniedByName?: string
  deniedByUserId?: string
  deniedByUserName?: string
  deniedAt: number
}

type QueuedEvent =
  | {
    type: 'TIMER_ACTION'
    action: 'START' | 'PAUSE' | 'RESET'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
    currentTime?: number // Optional: elapsed time for stored progress when starting
  }
  | {
    type: 'CREATE_TIMER'
    timestamp: number
    roomId: string
    timer: Timer
    clientId: string
  }
  | {
    type: 'UPDATE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    changes: Partial<Omit<Timer, 'id' | 'roomId'>>
    clientId: string
  }
  | {
    type: 'DELETE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
  }
  | {
    type: 'REORDER_TIMERS'
    timestamp: number
    roomId: string
    timerIds: string[]
    clientId: string
  }
  | {
    type: 'ROOM_STATE_PATCH'
    timestamp: number
    roomId: string
    changes: Partial<CompanionRoomState>
    clientId: string
  }

const DEFAULT_ROOM_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const DEFAULT_FEATURES = {
  localMode: true,
  showControl: false,
  powerpoint: false,
  externalVideo: false,
}

const DEFAULT_ROOM_STATE: Room['state'] = {
  activeTimerId: null,
  isRunning: false,
  startedAt: null,
  elapsedOffset: 0,
  progress: {},
  showClock: false,
  clockMode: '24h',
  message: {
    text: '',
    visible: false,
    color: 'green',
  },
  currentTime: 0,
  lastUpdate: 0,
}

const DEFAULT_AUTHORITY: RoomAuthority = {
  source: 'cloud',
  status: 'ready',
  lastSyncAt: 0,
}

const ROOM_CACHE_KEY = 'ontime:companionRoomCache.v2'
const SUBS_CACHE_KEY = 'ontime:companionSubs.v2'
const CONTROL_CHANNEL_NAME = 'ontime:control:channel'
const CACHE_LIMIT = 20

type CachedRoomSnapshot = {
  roomId: string
  room: Room
  timers: Timer[]
  dataTs: number
  cachedAt: number
  source: 'companion' | 'cloud'
}

const readCachedSubscriptions = (): Record<string, { clientType: 'controller' | 'viewer'; token: string }> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SUBS_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, { clientType: 'controller' | 'viewer'; token: string }>
    return parsed ?? {}
  } catch {
    return {}
  }
}

const persistSubscriptions = (subs: Record<string, { clientType: 'controller' | 'viewer'; token: string }>) => {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SUBS_CACHE_KEY, JSON.stringify(subs))
  } catch {
    // ignore
  }
}

const readRoomCache = (): Record<string, CachedRoomSnapshot> => {
  if (typeof localStorage === 'undefined') return {}
  try {
    const now = Date.now()
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    const raw = localStorage.getItem(ROOM_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<
      string,
      CachedRoomSnapshot & { updatedAt?: number; cachedAt?: number; dataTs?: number }
    >
    return Object.entries(parsed ?? {}).reduce<Record<string, CachedRoomSnapshot>>((acc, [roomId, entry]) => {
      if (!entry || typeof entry !== 'object') return acc
      const legacyUpdatedAt = (entry as { updatedAt?: number }).updatedAt
      const cachedAt =
        typeof entry.cachedAt === 'number'
          ? entry.cachedAt
          : typeof legacyUpdatedAt === 'number'
            ? legacyUpdatedAt
            : Date.now()
      const dataTs =
        typeof entry.dataTs === 'number'
          ? entry.dataTs
          : entry.room?.state?.lastUpdate ?? (typeof legacyUpdatedAt === 'number' ? legacyUpdatedAt : 0)
      if (isOnline && now - cachedAt > PREVIEW_CACHE_TTL_MS) {
        return acc
      }
      acc[roomId] = {
        roomId: entry.roomId ?? roomId,
        room: entry.room,
        timers: entry.timers ?? [],
        dataTs,
        cachedAt,
        source: entry.source === 'companion' ? 'companion' : 'cloud',
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

const persistRoomCache = (entries: Record<string, CachedRoomSnapshot>) => {
  if (typeof localStorage === 'undefined') return
  try {
    const ordered = Object.values(entries)
      .sort((a, b) => b.cachedAt - a.cachedAt)
      .slice(0, CACHE_LIMIT)
    const trimmed = ordered.reduce<Record<string, CachedRoomSnapshot>>((acc, entry) => {
      acc[entry.roomId] = entry
      return acc
    }, {})
    localStorage.setItem(ROOM_CACHE_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

const SESSION_CLIENT_ID_KEY = 'ontime:companionClientId'
const MAX_QUEUE = 100
const QUEUE_WARNING_THRESHOLD = 0.8
const PREVIEW_CACHE_TTL_MS = 10_000
const BASE_CONFIDENCE_WINDOW_MS = 2000
const CHURN_CONFIDENCE_WINDOW_MS = 4000

export const getConfidenceWindowMs = (hasReconnectChurn: boolean) =>
  hasReconnectChurn ? CHURN_CONFIDENCE_WINDOW_MS : BASE_CONFIDENCE_WINDOW_MS

export const resolveRoomSource = ({
  isCompanionLive,
  viewerSyncGuard,
  firebaseTs,
  companionTs,
  authoritySource,
  mode,
  effectiveMode,
  confidenceWindowMs,
  controllerTieBreaker,
}: {
  isCompanionLive: boolean
  viewerSyncGuard: boolean
  firebaseTs: number
  companionTs: number
  authoritySource: RoomAuthority['source']
  mode: 'auto' | 'cloud' | 'local'
  effectiveMode: 'cloud' | 'local'
  confidenceWindowMs: number
  controllerTieBreaker?: 'cloud' | 'companion'
}): 'cloud' | 'companion' => {
  if (!isCompanionLive) return 'cloud'
  if (viewerSyncGuard) return 'cloud'

  if (firebaseTs === companionTs && controllerTieBreaker) {
    return controllerTieBreaker
  }

  if (Math.abs(firebaseTs - companionTs) < confidenceWindowMs) {
    if (authoritySource === 'companion' || authoritySource === 'pending') return 'companion'
    return 'cloud'
  }

  if (mode === 'auto') {
    return companionTs > firebaseTs ? 'companion' : 'cloud'
  }

  if (effectiveMode === 'local') {
    return companionTs >= firebaseTs ? 'companion' : 'cloud'
  }

  return firebaseTs >= companionTs ? 'cloud' : 'companion'
}

const translateCompanionStateToFirebase = (
  companion: CompanionRoomState,
  fallbackState?: Room['state'],
): Room['state'] => {
  const base = fallbackState ?? DEFAULT_ROOM_STATE
  // Companion reports currentTime as elapsed-at-lastUpdate; align startedAt with lastUpdate for UI math.
  const startedAt = companion.isRunning ? companion.lastUpdate : null
  return {
    ...base,
    activeTimerId: companion.activeTimerId ?? null,
    isRunning: companion.isRunning,
    startedAt,
    elapsedOffset: companion.currentTime,
    currentTime: companion.currentTime,
    lastUpdate: companion.lastUpdate,
    activeLiveCueId: companion.activeLiveCueId ?? base.activeLiveCueId,
  }
}

export const isSnapshotStale = (
  state: Room['state'],
  snapshotTimestamp: number,
  now: number = Date.now(),
  timer?: Timer,
): boolean => {
  const age = now - snapshotTimestamp
  // Do not clamp; bonus time can make elapsed negative.
  const baseElapsed = (state.elapsedOffset ?? state.currentTime ?? 0) as number
  const hasProgress =
    baseElapsed !== 0 || Object.values(state.progress ?? {}).some((val) => (val ?? 0) !== 0)
  const adjustments = timer?.adjustmentLog?.filter(
    (entry) => entry.timestamp > snapshotTimestamp && entry.timestamp < now,
  ) ?? []
  const totalAdjustments = adjustments.reduce((sum, entry) => sum + entry.delta, 0)
  const adjustedElapsed = baseElapsed + age + totalAdjustments

  if (state.isRunning) {
    if (timer?.duration) {
      return adjustedElapsed > timer.duration * 1000 * 3
    }
    return age > 30_000
  }

  if (hasProgress) {
    return age > 24 * 60 * 60 * 1000
  }

  return false
}

const buildRoomFromCompanion = (
  roomId: string,
  companionState: CompanionRoomState,
  baseRoom?: Room,
): Room => {
  const base: Room =
    baseRoom ?? {
      id: roomId,
      ownerId: 'local',
      title: 'Local Room',
      timezone: 'UTC',
      createdAt: Date.now(),
      order: 0,
      config: DEFAULT_ROOM_CONFIG,
      state: DEFAULT_ROOM_STATE,
      tier: 'basic',
      features: DEFAULT_FEATURES,
      _version: 1,
    }

  return {
    ...base,
    config: base.config ?? DEFAULT_ROOM_CONFIG,
    features: base.features ?? DEFAULT_FEATURES,
    state: translateCompanionStateToFirebase(companionState, base.state),
  }
}

const buildDefaultCompanionState = (): CompanionRoomState => ({
  activeTimerId: null,
  isRunning: false,
  currentTime: 0,
  lastUpdate: Date.now(),
})

const UnifiedDataResolver = ({ children }: { children: ReactNode }) => {
  const debugCompanion = import.meta.env.VITE_DEBUG_COMPANION === 'true'
  const firebase = useDataContext()
  const { user } = useAuth()
  const { effectiveMode, mode } = useAppMode()
  const {
    socket,
    handshakeStatus,
    token,
    fetchToken,
    clearToken,
    markHandshakePending,
    capabilitiesRevision,
    reconnectChurn,
  } = useCompanionConnection()
  const [roomAuthority, setRoomAuthority] = useState<Record<string, RoomAuthority>>({})
  const [companionRooms, setCompanionRooms] = useState<Record<string, CompanionRoomState>>({})
  const [companionTimers, setCompanionTimers] = useState<Record<string, Timer[]>>({})
  const [companionLiveCues, setCompanionLiveCues] = useState<Record<string, Record<string, LiveCueRecord>>>({})
  const [controllerLocks, setControllerLocks] = useState<Record<string, ControllerLock | null>>({})
  const [roomPins, setRoomPins] = useState<Record<string, string | null>>({})
  const [roomClients, setRoomClients] = useState<Record<string, ControllerClient[]>>({})
  const [controlRequests, setControlRequests] = useState<Record<string, ControlRequest | null>>({})
  const [pendingControlRequests, setPendingControlRequests] = useState<Record<string, ControlRequest | null>>({})
  const [controlDenials, setControlDenials] = useState<Record<string, ControlDenial | null>>({})
  const [controlDisplacements, setControlDisplacements] = useState<Record<
    string,
    { takenAt: number; takenById: string; takenByName?: string; takenByUserId?: string; takenByUserName?: string } | null
  >>({})
  const [controlErrors, setControlErrors] = useState<Record<string, { code: string; message: string; receivedAt: number } | null>>({})
  const [subscribedRooms, setSubscribedRooms] = useState<
    Record<string, { clientType: 'controller' | 'viewer'; token: string }>
  >({})
  const [cachedSnapshots, setCachedSnapshots] = useState<Record<string, CachedRoomSnapshot>>(() => readRoomCache())
  const [queueStatus, setQueueStatus] = useState<
    Record<string, { count: number; max: number; nearLimit: boolean; percent: number }>
  >({})
  const cachedSnapshotsRef = useRef<Record<string, CachedRoomSnapshot>>(cachedSnapshots)
  const [clientId] = useState(() => {
    if (typeof sessionStorage === 'undefined') return crypto.randomUUID()
    const cached = sessionStorage.getItem(SESSION_CLIENT_ID_KEY)
    if (cached) return cached
    const next = crypto.randomUUID()
    sessionStorage.setItem(SESSION_CLIENT_ID_KEY, next)
    return next
  })
  const subscribedRoomsRef = useRef(subscribedRooms)
  const pendingSyncRoomsRef = useRef<Set<string>>(new Set())
  const companionRoomsRef = useRef(companionRooms)
  const companionTimersRef = useRef(companionTimers)
  const controllerLocksRef = useRef(controllerLocks)
  const liveCueRateRef = useRef<Record<string, number>>({})
  const tokenRefreshInFlightRef = useRef(false)
  const bootstrappedSubsRef = useRef(false)
  const isReplayingRef = useRef(false)
  const lastControllerWriteRef = useRef<Record<string, { source: 'cloud' | 'companion'; timestamp: number }>>({})
  const joinQueueRef = useRef<Array<{ roomId: string; clientType: 'controller' | 'viewer'; token: string }>>([])
  const joinPendingRef = useRef(false)
  const activeJoinRef = useRef<{ roomId: string; clientType: 'controller' | 'viewer'; token: string } | null>(null)
  const lastCapabilitiesRevisionRef = useRef<number | null>(null)
  const lastTierSignatureRef = useRef<string | null>(null)
  const reconnectSyncPendingRef = useRef(false)
  const firestore = db
  const firestoreWriteThrough = Boolean(firestore)
  const isViewerClient = useCallback(
    (roomId: string) => subscribedRoomsRef.current[roomId]?.clientType === 'viewer',
    [],
  )
  const isCompanionLive = useCallback(
    () => Boolean(socket?.connected && handshakeStatus === 'ack'),
    [handshakeStatus, socket],
  )
  const confidenceWindowMs = useMemo(() => getConfidenceWindowMs(reconnectChurn), [reconnectChurn])
  const markControllerWrite = useCallback((roomId: string, source: 'cloud' | 'companion') => {
    lastControllerWriteRef.current = {
      ...lastControllerWriteRef.current,
      [roomId]: { source, timestamp: Date.now() },
    }
  }, [])
  const clearRoomCache = useCallback((reason: string) => {
    if (debugCompanion) {
      console.info('[UnifiedDataContext] clearing room cache', { reason })
    }
    cachedSnapshotsRef.current = {}
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(ROOM_CACHE_KEY)
      } catch {
        // ignore
      }
    }
    setCachedSnapshots({})
  }, [debugCompanion])
  const isLockedOut = useCallback(
    (roomId: string) => {
      const lock = controllerLocksRef.current[roomId]
      return Boolean(lock && lock.clientId !== clientId)
    },
    [clientId],
  )
  const canWriteThrough = useCallback(
    (roomId: string) => {
      if (!firestoreWriteThrough || !firestore) return false
      if (isLockedOut(roomId)) return false
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const localAuthoritative = isCompanionLive() && (authority.source === 'companion' || authority.source === 'pending')
      const isBridgeController = subscribedRoomsRef.current[roomId]?.clientType === 'controller'
      if (localAuthoritative && !isBridgeController) return false
      return true
    },
    [firestore, firestoreWriteThrough, isCompanionLive, isLockedOut, roomAuthority],
  )
  const ensureCloudWriteAllowed = useCallback(
    (roomId: string, action: string) => {
      if (!canWriteThrough(roomId)) {
        console.warn(`[UnifiedDataContext] cloud write blocked (${action})`, roomId)
        return false
      }
      return true
    },
    [canWriteThrough],
  )
  const deviceName = useMemo(() => {
    if (typeof window === 'undefined') return undefined
    const rawPlatform =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser support check
      (navigator as any).userAgentData?.platform ??
      navigator.platform ??
      ''
    const trimmed = rawPlatform.trim()
    const platformLabel = (() => {
      if (/^mac/i.test(trimmed) || trimmed === 'MacIntel') return 'macOS'
      if (/^win/i.test(trimmed)) return 'Windows'
      if (/^linux/i.test(trimmed)) return 'Linux'
      return trimmed || 'Browser'
    })()
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const isElectron = /Electron/i.test(ua)
    const browserLabel = (() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser support check
      const brands = (navigator as any).userAgentData?.brands as Array<{ brand: string }> | undefined
      const brand = brands?.find((entry) =>
        /Chrome|Chromium|Edge|Brave|Opera|Firefox|Safari/i.test(entry.brand),
      )?.brand
      if (brand) return brand.replace('Chromium', 'Chrome')
      if (/Edg\//i.test(ua)) return 'Edge'
      if (/OPR\//i.test(ua)) return 'Opera'
      if (/Firefox\//i.test(ua)) return 'Firefox'
      if (/Chrome\//i.test(ua)) return 'Chrome'
      if (/Safari\//i.test(ua)) return 'Safari'
      return 'Browser'
    })()
    const appLabel = isElectron ? 'Electron' : browserLabel
    return `${appLabel} on ${platformLabel}`.slice(0, 120)
  }, [])

  const processJoinQueue = useCallback(() => {
    if (!socket) return
    if (joinPendingRef.current) return
    const next = joinQueueRef.current.shift()
    if (!next) return
    if (!token) {
      joinQueueRef.current.unshift(next)
      return
    }
    const joinToken = next.token !== token ? token : next.token
    if (!socket.connected && !socket.active) {
      joinQueueRef.current.unshift({ ...next, token: joinToken })
      socket.connect()
      return
    }
    joinPendingRef.current = true
    activeJoinRef.current = { ...next, token: joinToken }
    markHandshakePending()
    if (debugCompanion) {
      console.info('[companion] JOIN_ROOM', { roomId: next.roomId, clientType: next.clientType, clientId })
    }
    const ownerId = firebase.getRoom(next.roomId)?.ownerId
    socket.emit('JOIN_ROOM', {
      type: 'JOIN_ROOM',
      roomId: next.roomId,
      token: joinToken,
      clientType: next.clientType,
      clientId,
      deviceName,
      userId: user?.uid,
      userName: user?.displayName,
      ownerId,
      interfaceVersion: INTERFACE_VERSION,
    })
  }, [clientId, debugCompanion, deviceName, firebase, markHandshakePending, socket, token, user?.displayName, user?.uid])

  const enqueueJoin = useCallback(
    (roomId: string, clientType: 'controller' | 'viewer', joinToken: string) => {
      joinQueueRef.current.push({ roomId, clientType, token: joinToken })
      processJoinQueue()
    },
    [processJoinQueue],
  )

  useEffect(() => {
    subscribedRoomsRef.current = subscribedRooms
  }, [subscribedRooms])

  useEffect(() => {
    if (capabilitiesRevision === 0) return
    if (lastCapabilitiesRevisionRef.current === capabilitiesRevision) return
    lastCapabilitiesRevisionRef.current = capabilitiesRevision
    window.setTimeout(() => {
      clearRoomCache('companion_capabilities')
    }, 0)
  }, [capabilitiesRevision, clearRoomCache])

  useEffect(() => {
    const signature = (firebase.rooms ?? [])
      .map((room) => {
        const features = room.features
        return [
          room.id,
          room.tier ?? 'basic',
          features?.showControl ? '1' : '0',
          features?.powerpoint ? '1' : '0',
          features?.externalVideo ? '1' : '0',
        ].join(':')
      })
      .sort()
      .join('|')
    if (lastTierSignatureRef.current === null) {
      lastTierSignatureRef.current = signature
      return
    }
    if (lastTierSignatureRef.current === signature) return
    lastTierSignatureRef.current = signature
    window.setTimeout(() => {
      clearRoomCache('room_tier_change')
    }, 0)
  }, [clearRoomCache, firebase.rooms])

  useEffect(() => {
    if (!token) return
    const entries = Object.entries(subscribedRoomsRef.current)
    if (!entries.length) return

    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep subscription tokens in sync with refreshed token
    setSubscribedRooms((prev) => {
      let changed = false
      const next = { ...prev }
      Object.entries(prev).forEach(([roomId, sub]) => {
        if (sub.token !== token) {
          next[roomId] = { ...sub, token }
          changed = true
        }
      })
      if (changed) {
        persistSubscriptions(next)
        return next
      }
      return prev
    })

    entries.forEach(([roomId, sub]) => {
      enqueueJoin(roomId, sub.clientType, token)
    })
  }, [enqueueJoin, token])

  useEffect(() => {
    companionRoomsRef.current = companionRooms
  }, [companionRooms])

  useEffect(() => {
    companionTimersRef.current = companionTimers
  }, [companionTimers])

  useEffect(() => {
    controllerLocksRef.current = controllerLocks
  }, [controllerLocks])


  const addPendingSyncRoom = useCallback((roomId: string) => {
    const current = pendingSyncRoomsRef.current
    if (current.has(roomId)) return
    const next = new Set(current)
    next.add(roomId)
    pendingSyncRoomsRef.current = next
  }, [])

  const removePendingSyncRoom = useCallback((roomId: string) => {
    const current = pendingSyncRoomsRef.current
    if (!current.has(roomId)) return
    const next = new Set(current)
    next.delete(roomId)
    pendingSyncRoomsRef.current = next
  }, [])

  const clearPendingSyncRooms = useCallback(() => {
    pendingSyncRoomsRef.current = new Set()
  }, [])

  const getRoomAuthority = useCallback(
    (roomId: string) => roomAuthority[roomId] ?? DEFAULT_AUTHORITY,
    [roomAuthority],
  )

  const forceCloudAuthority = useCallback((roomId: string) => {
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'cloud',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [])

  const forceCompanionAuthority = useCallback((roomId: string) => {
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'companion',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [])

  const getControllerLock = useCallback(
    (roomId: string) => controllerLocks[roomId] ?? null,
    [controllerLocks],
  )

  const getControllerLockState = useCallback(
    (roomId: string): ControllerLockState =>
      resolveControllerLockState({
        roomId,
        clientId,
        controllerLocks,
        controlDisplacements,
        pendingControlRequests,
      }),
    [clientId, controlDisplacements, controllerLocks, pendingControlRequests],
  )

  const getRoomPin = useCallback(
    (roomId: string) => roomPins[roomId] ?? null,
    [roomPins],
  )

  const setRoomPin = useCallback(
    (roomId: string, pin: string | null) => {
      if (!socket) return
      const lock = controllerLocksRef.current[roomId]
      if (lock && lock.clientId !== clientId) return
      socket.emit('SET_ROOM_PIN', {
        type: 'SET_ROOM_PIN',
        roomId,
        pin,
        timestamp: Date.now(),
      })
    },
    [clientId, socket],
  )

  const requestControl = useCallback(
    (roomId: string, overrideName?: string) => {
      if (!socket) return
      const payload = {
        type: 'REQUEST_CONTROL' as const,
        roomId,
        clientId,
        deviceName: overrideName ?? deviceName,
        userId: user?.uid,
        userName: user?.displayName,
        timestamp: Date.now(),
      }
      setPendingControlRequests((prev) => ({
        ...prev,
        [roomId]: {
          requesterId: clientId,
          requesterName: payload.deviceName,
          requesterUserId: payload.userId,
          requesterUserName: payload.userName,
          requestedAt: payload.timestamp,
        },
      }))
      setControlDenials((prev) => ({ ...prev, [roomId]: null }))
      setControlErrors((prev) => ({ ...prev, [roomId]: null }))
      socket.emit('REQUEST_CONTROL', payload)
    },
    [clientId, deviceName, socket, user?.displayName, user?.uid],
  )

  const forceTakeover = useCallback(
    (roomId: string, options?: { pin?: string; reauthenticated?: boolean }) => {
      if (!socket) return
      socket.emit('FORCE_TAKEOVER', {
        type: 'FORCE_TAKEOVER',
        roomId,
        clientId,
        pin: options?.pin,
        reauthenticated: options?.reauthenticated,
        timestamp: Date.now(),
      })
    },
    [clientId, socket],
  )

  const handOverControl = useCallback(
    (roomId: string, targetClientId: string) => {
      if (!socket) return
      socket.emit('HAND_OVER', {
        type: 'HAND_OVER',
        roomId,
        targetClientId,
        timestamp: Date.now(),
      })
    },
    [socket],
  )

  const denyControl = useCallback(
    (roomId: string, requesterId: string) => {
      if (!socket) return
      socket.emit('DENY_CONTROL', {
        type: 'DENY_CONTROL',
        roomId,
        requesterId,
        timestamp: Date.now(),
      })
    },
    [socket],
  )

  const sendHeartbeat = useCallback(
    (roomId: string) => {
      if (!socket) return
      socket.emit('HEARTBEAT', {
        type: 'HEARTBEAT',
        roomId,
        clientId,
        timestamp: Date.now(),
      })
    },
    [clientId, socket],
  )

  const subscribeToCompanionRoom = useCallback(
    (roomId: string, clientType: 'controller' | 'viewer', tokenOverride?: string) => {
      void (async () => {
        const joinToken = token ?? (await fetchToken()) ?? tokenOverride ?? null
        if (!joinToken) {
          console.warn('[UnifiedDataContext] missing Companion token for room', roomId)
          return
        }

        setSubscribedRooms((prev) => {
          const next = { ...prev, [roomId]: { clientType, token: joinToken } }
          persistSubscriptions(next)
          return next
        })

        setRoomAuthority((prev) => ({
          ...prev,
          [roomId]: {
            source: 'pending',
            status: 'syncing',
            lastSyncAt: Date.now(),
          },
        }))

        if (clientType === 'controller') {
          addPendingSyncRoom(roomId)
        }

        enqueueJoin(roomId, clientType, joinToken)
      })()
    },
    [addPendingSyncRoom, enqueueJoin, fetchToken, token],
  )

  useEffect(() => {
    if (bootstrappedSubsRef.current) return
    // Only restore subscriptions when companion is connected and handshake successful
    if (!socket || !token || handshakeStatus !== 'ack') return

    bootstrappedSubsRef.current = true
    const saved = readCachedSubscriptions()
    if (!Object.keys(saved).length) return

    if (debugCompanion) {
      console.info('[companion] restoring subscriptions', Object.keys(saved))
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate cached subscriptions after handshake
    setSubscribedRooms(() => {
      // Update tokens in saved subscriptions to match current token
      const updated = Object.entries(saved).reduce<Record<string, { clientType: 'controller' | 'viewer'; token: string }>>((acc, [roomId, sub]) => {
        acc[roomId] = { ...sub, token: token }
        return acc
      }, {})
      persistSubscriptions(updated)
      return updated
    })
  }, [debugCompanion, handshakeStatus, socket, token])

  const unsubscribeFromCompanionRoom = useCallback((roomId: string) => {
    setSubscribedRooms((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      persistSubscriptions(next)
      return next
    })
    setCompanionRooms((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    setCompanionTimers((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    cachedSnapshotsRef.current = (() => {
      const next = { ...cachedSnapshotsRef.current }
      if (next[roomId]) {
        delete next[roomId]
        persistRoomCache(next)
      }
      return next
    })()
    setControllerLocks((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    setControlRequests((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    setPendingControlRequests((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    setControlDenials((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
    removePendingSyncRoom(roomId)
    setRoomAuthority((prev) => ({
      ...prev,
      [roomId]: {
        source: 'cloud',
        status: 'ready',
        lastSyncAt: Date.now(),
      },
    }))
  }, [removePendingSyncRoom])

  const shouldUseCompanion = useCallback(
    (roomId: string) => {
      return Boolean(subscribedRooms[roomId])
    },
    [subscribedRooms],
  )

  const canUseLiveCues = useCallback(
    (roomId: string) => {
      const room = firebase.getRoom(roomId)
      const tier = room?.tier
      const features = room?.features
      return Boolean(features?.showControl || tier === 'show_control' || tier === 'production')
    },
    [firebase],
  )

  const recordLiveCueRate = useCallback((roomId: string, now: number) => {
    const last = liveCueRateRef.current[roomId] ?? 0
    liveCueRateRef.current[roomId] = now
    return now - last < 1000
  }, [])

  const resolveLiveCueWriteSource = useCallback(
    (roomId: string): LiveCueRecord['source'] | null => {
      if (!firestoreWriteThrough || !firestore) return null
      if (isViewerClient(roomId)) return null
      const lock = controllerLocksRef.current[roomId]
      const isBridgeController = subscribedRoomsRef.current[roomId]?.clientType === 'controller'
      if (isBridgeController && (!lock || lock.clientId === clientId)) {
        return 'controller'
      }
      if (!lock) return 'companion'
      return Date.now() - lock.lastHeartbeat > 5000 ? 'companion' : null
    },
    [clientId, firestore, firestoreWriteThrough, isViewerClient],
  )

  const upsertCompanionLiveCue = useCallback((roomId: string, record: LiveCueRecord) => {
    setCompanionLiveCues((prev) => {
      const roomRecords = { ...(prev[roomId] ?? {}) }
      roomRecords[record.cue.id] = record
      return {
        ...prev,
        [roomId]: roomRecords,
      }
    })
  }, [])

  const removeCompanionLiveCue = useCallback((roomId: string, cueId: string) => {
    setCompanionLiveCues((prev) => {
      const roomRecords = prev[roomId]
      if (!roomRecords || !roomRecords[cueId]) return prev
      const nextRoom = { ...roomRecords }
      delete nextRoom[cueId]
      return {
        ...prev,
        [roomId]: nextRoom,
      }
    })
  }, [])

  const setCompanionActiveLiveCueId = useCallback((roomId: string, cueId: string | null) => {
    setCompanionRooms((prev) => {
      const current = prev[roomId]
      if (!current) {
        if (debugCompanion) {
          console.info('[companion] activeLiveCueId ignored: missing room', {
            roomId,
            cueId,
          })
        }
        return prev
      }
      if (!current || current.activeLiveCueId === cueId) return prev
      return {
        ...prev,
        [roomId]: {
          ...current,
          activeLiveCueId: cueId ?? undefined,
        },
      }
    })
  }, [])

  const writeActiveLiveCueId = useCallback(
    async (roomId: string, cueId: string | null) => {
      if (!firestoreWriteThrough || !firestore) return
      const room = firebase.getRoom(roomId)
      const payload = room?._version === 2
        ? { activeLiveCueId: cueId }
        : { 'state.activeLiveCueId': cueId }
      const ref = room?._version === 2
        ? doc(firestore, 'rooms', roomId, 'state', 'current')
        : doc(firestore, 'rooms', roomId)
      await updateDoc(ref, payload as Record<string, unknown>).catch(() => undefined)
    },
    [firebase, firestore, firestoreWriteThrough],
  )

  const writeLiveCueToFirestore = useCallback(
    async (roomId: string, record: LiveCueRecord) => {
      if (!firestoreWriteThrough || !firestore) return
      const liveCueRef = doc(firestore, 'rooms', roomId, 'liveCues', record.cue.id)
      const payload = {
        ...record.cue,
        updatedAt: record.updatedAt,
        writeSource: record.source,
      } as Record<string, unknown>
      await setDoc(liveCueRef, payload, { merge: true }).catch(() => undefined)
    },
    [firestore, firestoreWriteThrough],
  )

  const deleteLiveCueFromFirestore = useCallback(
    async (roomId: string, cueId: string) => {
      if (!firestoreWriteThrough || !firestore) return
      await deleteDoc(doc(firestore, 'rooms', roomId, 'liveCues', cueId)).catch(() => undefined)
    },
    [firestore, firestoreWriteThrough],
  )

  useEffect(() => {
    const roomIds = new Set<string>([
      ...Object.keys(subscribedRoomsRef.current),
      ...Object.keys(companionRoomsRef.current),
      ...Object.keys(companionTimersRef.current),
      ...Object.keys(cachedSnapshotsRef.current),
      ...Object.keys(roomAuthority),
      ...(firebase.rooms ?? []).map((room) => room.id),
    ])

    // Prevent overwriting cache with empty data on initial load before Firebase/Companion data arrives.
    // If we have cached data but no fresh data sources, preserve the cache.
    const hasFirebaseData = (firebase.rooms ?? []).length > 0
    const hasCompanionData = Object.keys(companionRoomsRef.current).length > 0
    const hasCachedData = Object.keys(cachedSnapshotsRef.current).length > 0
    if (hasCachedData && !hasFirebaseData && !hasCompanionData) {
      return
    }

    const nextCache: Record<string, CachedRoomSnapshot> = {}
    const companionLive = isCompanionLive()
    roomIds.forEach((roomId) => {
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const usingCompanion =
        companionLive &&
        (authority.source === 'companion' || authority.source === 'pending' || shouldUseCompanion(roomId))
      const companionState = usingCompanion ? companionRoomsRef.current[roomId] : undefined
      const resolvedRoom = companionState
        ? buildRoomFromCompanion(roomId, companionState, firebase.getRoom(roomId))
        : firebase.getRoom(roomId)
      if (!resolvedRoom) {
        // Only preserve cached room if Firebase data hasn't loaded yet.
        // If Firebase has loaded and this room isn't there, it was likely deleted.
        // Also preserve if companion has data for this room (local-only scenario).
        const hasCompanionDataForRoom = Boolean(companionRoomsRef.current[roomId])
        const cached = cachedSnapshotsRef.current[roomId]
        if (cached && (!hasFirebaseData || hasCompanionDataForRoom)) {
          nextCache[roomId] = cached
        }
        return
      }
      const freshTimers = usingCompanion
        ? companionTimersRef.current[roomId] ?? firebase.getTimers(roomId)
        : firebase.getTimers(roomId)
      // Preserve cached timers if fresh timers haven't loaded yet (prevents flash of empty rundown)
      const cachedEntry = cachedSnapshotsRef.current[roomId]
      const timers = (freshTimers ?? []).length > 0 ? freshTimers : (cachedEntry?.timers ?? [])

      // Preserve cached progress if fresh room has empty progress
      const cachedProgress = cachedEntry?.room?.state.progress ?? {}
      const roomProgress = resolvedRoom.state.progress ?? {}
      const hasCachedProgress = Object.keys(cachedProgress).length > 0
      const progressToUse = hasCachedProgress ? mergeProgress(roomProgress, cachedProgress) : roomProgress

      const finalRoom: Room = {
        ...resolvedRoom,
        state: {
          ...resolvedRoom.state,
          progress: progressToUse,
        },
      }

      const dataTs = finalRoom.state.lastUpdate ?? 0
      nextCache[roomId] = {
        roomId,
        room: finalRoom,
        timers,
        dataTs,
        cachedAt: Date.now(),
        source: usingCompanion ? 'companion' : 'cloud',
      }
    })
    cachedSnapshotsRef.current = nextCache
    persistRoomCache(nextCache)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep cache state in sync with persisted snapshots
    setCachedSnapshots(nextCache)
  }, [companionRooms, companionTimers, firebase, isCompanionLive, roomAuthority, shouldUseCompanion])

  const ensureCompanionRoomState = useCallback((roomId: string) => {
    const existing = companionRoomsRef.current[roomId]
    if (existing) return existing
    const next = buildDefaultCompanionState()
    setCompanionRooms((prev) => ({ ...prev, [roomId]: next }))
    return next
  }, [])

  // Use shared timer-utils for elapsed calculations
  const computeCurrentTimeMs = useCallback((room: Room): number => {
    return computeElapsed({
      isRunning: room.state.isRunning ?? false,
      startedAt: room.state.startedAt ?? null,
      elapsedOffset: room.state.elapsedOffset ?? 0,
    })
  }, [])

  const computeCurrentTimeWithProgress = useCallback(
    (room: Room): number => {
      const activeId = room.state.activeTimerId

      // For running timers, always calculate live elapsed time to avoid stale progress values
      if (room.state.isRunning) {
        return computeCurrentTimeMs(room)
      }

      // For paused timers, use progress map if available
      // Allow negative elapsed to support bonus time (added beyond original duration)
      const progress = room.state.progress ?? {}
      if (activeId && typeof progress[activeId] === 'number') {
        return progress[activeId] as number
      }

      return computeCurrentTimeMs(room)
    },
    [computeCurrentTimeMs],
  )

  const resolveElapsedForTimer = useCallback((room: Room | undefined, timerId: string): number => {
    if (!room) return 0
    return resolveTimerElapsed({
      isRunning: room.state.isRunning,
      startedAt: room.state.startedAt,
      elapsedOffset: room.state.elapsedOffset,
      activeTimerId: room.state.activeTimerId,
      progress: room.state.progress,
    }, timerId)
  }, [])

  const computeCompanionElapsed = useCallback((state: CompanionRoomState) => {
    return computeCompanionElapsedUtil(state)
  }, [])

  const updateQueueStatus = useCallback((roomId: string, queue: QueuedEvent[]) => {
    const count = queue.length
    const percent = MAX_QUEUE > 0 ? count / MAX_QUEUE : 0
    setQueueStatus((prev) => ({
      ...prev,
      [roomId]: {
        count,
        max: MAX_QUEUE,
        percent,
        nearLimit: percent >= QUEUE_WARNING_THRESHOLD,
      },
    }))
  }, [])

  const loadQueue = useCallback((roomId: string): QueuedEvent[] => {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(`ontime:queue:${roomId}`)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      const queue = parsed
        .map((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return null
          const record = entry as Record<string, unknown>
          if (typeof record.type === 'string') return entry as QueuedEvent
          if (
            typeof record.action === 'string' &&
            typeof record.roomId === 'string' &&
            typeof record.timerId === 'string' &&
            typeof record.timestamp === 'number' &&
            typeof record.clientId === 'string'
          ) {
            return {
              type: 'TIMER_ACTION',
              action: record.action as 'START' | 'PAUSE' | 'RESET',
              roomId: record.roomId,
              timerId: record.timerId,
              timestamp: record.timestamp,
              clientId: record.clientId,
            } as QueuedEvent
          }
          return null
        })
        .filter(Boolean) as QueuedEvent[]
      updateQueueStatus(roomId, queue)
      return queue
    } catch (error) {
      console.warn('[UnifiedDataContext] Failed to load queue', error)
      return []
    }
  }, [updateQueueStatus])

  const saveQueue = useCallback((roomId: string, queue: QueuedEvent[]) => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(`ontime:queue:${roomId}`, JSON.stringify(queue))
      updateQueueStatus(roomId, queue)
    } catch (error) {
      console.warn('[UnifiedDataContext] Failed to save queue', error)
    }
  }, [updateQueueStatus])

  const enqueueAction = useCallback(
    (roomId: string, action: QueuedEvent) => {
      let queue = loadQueue(roomId)
      queue.push(action)
      if (queue.length > MAX_QUEUE) {
        const dropped = queue.length - MAX_QUEUE
        queue = queue.slice(dropped)
        console.warn('[UnifiedDataContext] Queue full, dropping oldest actions', {
          dropped,
          roomId,
        })
      }
      saveQueue(roomId, queue)
    },
    [loadQueue, saveQueue],
  )

  const mergeQueuedEvents = useCallback((queue: QueuedEvent[]): QueuedEvent[] => {
    const grouped = new Map<string, QueuedEvent[]>()
    const keyFor = (event: QueuedEvent) => {
      switch (event.type) {
        case 'TIMER_ACTION':
          return `TIMER_ACTION:${event.timerId}`
        case 'CREATE_TIMER':
        case 'UPDATE_TIMER':
        case 'DELETE_TIMER':
          return `TIMER_CRUD:${event.type === 'CREATE_TIMER' ? event.timer.id : event.timerId}`
        case 'REORDER_TIMERS':
          return `TIMER_REORDER:${event.roomId}`
        case 'ROOM_STATE_PATCH':
          return `ROOM_STATE_PATCH:${event.roomId}`
        default:
          return 'UNKNOWN'
      }
    }

    queue.forEach((event) => {
      const key = keyFor(event)
      const list = grouped.get(key) ?? []
      list.push(event)
      grouped.set(key, list)
    })

    const merged: QueuedEvent[] = []
    grouped.forEach((events) => {
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
      const latest = sorted[sorted.length - 1]

      if (latest.type === 'ROOM_STATE_PATCH') {
        merged.push(latest)
        return
      }

      const deletes = sorted.filter((event) => event.type === 'DELETE_TIMER') as Array<
        Extract<QueuedEvent, { type: 'DELETE_TIMER' }>
      >
      if (deletes.length) {
        merged.push(deletes[deletes.length - 1])
        return
      }

      const creates = sorted.filter((event) => event.type === 'CREATE_TIMER') as Array<
        Extract<QueuedEvent, { type: 'CREATE_TIMER' }>
      >
      const updates = sorted.filter((event) => event.type === 'UPDATE_TIMER') as Array<
        Extract<QueuedEvent, { type: 'UPDATE_TIMER' }>
      >

      if (creates.length) {
        const create = creates[creates.length - 1]
        const update = updates[updates.length - 1]
        if (update) {
          const mergedTimer = { ...create.timer, ...(update.changes as Partial<Timer>) }
          const useUpdate = update.timestamp >= create.timestamp
          merged.push({
            ...create,
            timer: mergedTimer,
            timestamp: Math.max(create.timestamp, update.timestamp),
            clientId: useUpdate ? update.clientId : create.clientId,
          })
          return
        }
        merged.push(create)
        return
      }

      merged.push(latest)
    })

    return merged.sort((a, b) => a.timestamp - b.timestamp)
  }, [])

  const replayRoomQueue = useCallback(
    (roomId: string, minTimestamp?: number) => {
      if (!socket) return
      const queue = loadQueue(roomId)
      if (!queue.length) return
      const filtered =
        typeof minTimestamp === 'number'
          ? queue.filter((event) => event.timestamp >= minTimestamp)
          : queue
      if (!filtered.length) {
        saveQueue(roomId, [])
        return
      }
      isReplayingRef.current = true
      const merged = mergeQueuedEvents(filtered)
      merged.forEach((item) => socket.emit(item.type, item))
      saveQueue(roomId, [])
      isReplayingRef.current = false
    },
    [loadQueue, mergeQueuedEvents, saveQueue, socket],
  )

  const emitOrQueue = useCallback(
    (roomId: string, event: QueuedEvent) => {
      const lock = controllerLocksRef.current[roomId]
      if (lock && lock.clientId !== clientId) {
        return
      }
      markControllerWrite(roomId, 'companion')
      const canEmit =
        socket?.connected && handshakeStatus === 'ack' && !isReplayingRef.current

      if (canEmit) {
        socket.emit(event.type, event)
      } else {
        enqueueAction(roomId, event)
      }
    },
    [clientId, enqueueAction, handshakeStatus, markControllerWrite, socket],
  )

  const emitSyncRoomState = useCallback(
    (roomId: string) => {
      if (!socket?.connected) return
      const lock = controllerLocksRef.current[roomId]
      if (lock && lock.clientId !== clientId) return
      const room = firebase.getRoom(roomId)
      if (!room) return
      const timers = firebase.getTimers(roomId)
      const currentTime = computeCurrentTimeWithProgress(room)
      const payload: SyncRoomStatePayload = {
        type: 'SYNC_ROOM_STATE',
        roomId,
        timers,
        state: {
          activeTimerId: room.state.activeTimerId ?? null,
          isRunning: room.state.isRunning ?? false,
          currentTime,
          lastUpdate: Date.now(),
        },
        sourceClientId: clientId,
        timestamp: Date.now(),
      }
      if (debugCompanion) {
        console.info('[companion] SYNC_ROOM_STATE emit', {
          roomId,
          timersCount: timers.length,
          currentTime,
        })
      }
      socket.emit('SYNC_ROOM_STATE', payload)
    },
    [clientId, computeCurrentTimeWithProgress, debugCompanion, firebase, socket],
  )

  const broadcastControlPayload = useCallback(
    (payload: ControlSyncPayload) => {
      try {
        const channel = new BroadcastChannel(CONTROL_CHANNEL_NAME)
        channel.postMessage({ sourceClientId: clientId, payload } as ControlSyncMessage)
        channel.close()
      } catch {
        // ignore
      }
    },
    [clientId],
  )

  const applyControlPayload = useCallback(
    (payload: ControlSyncPayload, options?: { broadcast?: boolean }) => {
      if (payload.type === 'CONTROLLER_LOCK_STATE') {
        const previousLock = controllerLocksRef.current[payload.roomId]
        const nextLock = payload.lock
        setControllerLocks((prev) => ({ ...prev, [payload.roomId]: nextLock }))
        if (nextLock?.clientId === clientId) {
          setPendingControlRequests((prev) => ({ ...prev, [payload.roomId]: null }))
          setControlRequests((prev) => ({ ...prev, [payload.roomId]: null }))
          setControlDenials((prev) => ({ ...prev, [payload.roomId]: null }))
          setControlDisplacements((prev) => ({ ...prev, [payload.roomId]: null }))
          setControlErrors((prev) => ({ ...prev, [payload.roomId]: null }))
        } else {
          setRoomPins((prev) => ({ ...prev, [payload.roomId]: null }))
          setPendingControlRequests((prev) => ({ ...prev, [payload.roomId]: null }))
        }
        if (previousLock?.clientId === clientId && nextLock && nextLock.clientId !== clientId) {
          setControlDisplacements((prev) => ({
            ...prev,
            [payload.roomId]: {
              takenAt: payload.timestamp,
              takenById: nextLock.clientId,
              takenByName: nextLock.deviceName,
              takenByUserId: nextLock.userId,
              takenByUserName: nextLock.userName,
            },
          }))
        }
      }

      if (payload.type === 'CONTROL_REQUEST_RECEIVED') {
        setControlRequests((prev) => ({
          ...prev,
          [payload.roomId]: {
            requesterId: payload.requesterId,
            requesterName: payload.requesterName,
            requesterUserId: payload.requesterUserId,
            requesterUserName: payload.requesterUserName,
            requestedAt: payload.timestamp,
          },
        }))
      }

      if (payload.type === 'CONTROL_REQUEST_DENIED') {
        setPendingControlRequests((prev) => ({ ...prev, [payload.roomId]: null }))
        setControlDenials((prev) => ({
          ...prev,
          [payload.roomId]: {
            requesterId: payload.requesterId,
            reason: payload.reason,
            deniedByName: payload.deniedByName,
            deniedByUserId: payload.deniedByUserId,
            deniedByUserName: payload.deniedByUserName,
            deniedAt: payload.timestamp,
          },
        }))
      }

      if (payload.type === 'ROOM_PIN_STATE') {
        setRoomPins((prev) => ({ ...prev, [payload.roomId]: payload.pin }))
      }

      if (payload.type === 'ROOM_CLIENTS_STATE') {
        setRoomClients((prev) => ({ ...prev, [payload.roomId]: payload.clients }))
      }

      if (payload.type === 'ERROR') {
        if (!payload?.code || !payload.message) return
        if (!payload.roomId) return
        const roomId = payload.roomId
        setControlErrors((prev) => ({
          ...prev,
          [roomId]: {
            code: payload.code ?? 'ERROR',
            message: payload.message ?? 'Unknown error',
            receivedAt: Date.now(),
          },
        }))
      }

      if (options?.broadcast) {
        broadcastControlPayload(payload)
      }
    },
    [broadcastControlPayload, clientId],
  )

  useEffect(() => {
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(CONTROL_CHANNEL_NAME)
      channel.onmessage = (event: MessageEvent) => {
        const message = event.data as ControlSyncMessage
        if (!message || message.sourceClientId === clientId) return
        applyControlPayload(message.payload, { broadcast: false })
      }
    } catch {
      channel = null
    }

    return () => {
      if (channel) {
        channel.onmessage = null
        channel.close()
      }
    }
  }, [applyControlPayload, clientId])

  useEffect(() => {
    if (!socket) return

    const handleConnect = async () => {
      if (debugCompanion) console.info('[companion] connect')

      const joinToken = token ?? (await fetchToken())
      if (!joinToken) {
        if (debugCompanion) console.warn('[companion] connect missing token, skipping JOIN replay')
        return
      }

      setSubscribedRooms((prev) => {
        let changed = false
        const next = { ...prev }
        Object.entries(prev).forEach(([roomId, sub]) => {
          if (sub.token !== joinToken) {
            next[roomId] = { ...sub, token: joinToken }
            changed = true
          }
        })
        if (changed) persistSubscriptions(next)
        return changed ? next : prev
      })

      const rooms = subscribedRoomsRef.current
      Object.entries(rooms).forEach(([roomId, sub]) => {
        enqueueJoin(roomId, sub.clientType, joinToken)
        if (sub.clientType === 'controller') {
          addPendingSyncRoom(roomId)
        }
      })
    }

    const handleDisconnect = () => {
      if (debugCompanion) console.info('[companion] disconnect')
      joinPendingRef.current = false
      reconnectSyncPendingRef.current = true
      if (activeJoinRef.current) {
        joinQueueRef.current.unshift(activeJoinRef.current)
        activeJoinRef.current = null
      }
      const rooms = subscribedRoomsRef.current
      const usingCompanion = effectiveMode !== 'cloud' && Object.keys(rooms).length > 0
      setRoomAuthority((prev) => {
        const next = { ...prev }
        Object.keys(rooms).forEach((roomId) => {
          next[roomId] = {
            source: usingCompanion ? 'companion' : 'cloud',
            status: 'degraded',
            lastSyncAt: Date.now(),
          }
        })
        return next
      })
      clearPendingSyncRooms()
    }

    const handleHandshakeError = (err: HandshakeError) => {
      joinPendingRef.current = false
      if (activeJoinRef.current) {
        joinQueueRef.current.unshift(activeJoinRef.current)
        activeJoinRef.current = null
      }
      if (err?.code === 'CONTROLLER_TAKEN') {
        // TODO: surface the request control flow in the UI when lock/takeover lands.
        return
      }
      if (err?.code !== 'INVALID_TOKEN') return
      joinQueueRef.current = []
      clearToken()
      if (tokenRefreshInFlightRef.current) return
      tokenRefreshInFlightRef.current = true
      void (async () => {
        const nextToken = await fetchToken()
        if (!nextToken) {
          tokenRefreshInFlightRef.current = false
          return
        }
        setSubscribedRooms((prev) => {
          const next: typeof prev = {}
          Object.entries(prev).forEach(([roomId, sub]) => {
            next[roomId] = { ...sub, token: nextToken }
          })
          return next
        })
        Object.entries(subscribedRoomsRef.current).forEach(([roomId, sub]) => {
          enqueueJoin(roomId, sub.clientType, nextToken)
        })
        tokenRefreshInFlightRef.current = false
      })()
    }

    const handleHandshakeAckQueue = () => {
      joinPendingRef.current = false
      activeJoinRef.current = null
      processJoinQueue()
      if (reconnectSyncPendingRef.current) {
        Object.entries(subscribedRoomsRef.current).forEach(([roomId, sub]) => {
          if (sub.clientType !== 'controller') return
          emitSyncRoomState(roomId)
        })
        reconnectSyncPendingRef.current = false
      }
    }

    const handleRoomStateSnapshot = (payload: RoomStateSnapshotPayload) => {
      const baseRoom = firebase.getRoom(payload.roomId)
      const snapshotTs = payload.state.lastUpdate ?? payload.timestamp ?? Date.now()
      const existingTs = companionRoomsRef.current[payload.roomId]?.lastUpdate ?? 0
      const firebaseTs = baseRoom?.state.lastUpdate ?? 0
      const isStale =
        snapshotTs + confidenceWindowMs < existingTs ||
        snapshotTs + confidenceWindowMs < firebaseTs
      if (debugCompanion) {
        console.info('[companion] ROOM_STATE_SNAPSHOT activeLiveCueId', {
          roomId: payload.roomId,
          activeLiveCueId: payload.state.activeLiveCueId ?? null,
          snapshotTs,
        })
      }
      if (isStale) {
        if (debugCompanion) {
          console.info('[companion] stale update ignored', {
            roomId: payload.roomId,
            incomingTs: snapshotTs,
            existingTs,
            firebaseTs,
          })
        }
        return
      }
      const translatedState = translateCompanionStateToFirebase(payload.state, baseRoom?.state)
      const cachedTimers = cachedSnapshotsRef.current[payload.roomId]?.timers ?? []
      const firebaseTimers = firebase.getTimers(payload.roomId)
      const timers = firebaseTimers.length ? firebaseTimers : cachedTimers
      const activeId = translatedState.activeTimerId ?? baseRoom?.state.activeTimerId ?? null
      if (import.meta.env.DEV) {
        console.info('[UData] ROOM_STATE_SNAPSHOT', {
          roomId: payload.roomId,
          activeId,
          currentTime: translatedState.currentTime,
          elapsedOffset: translatedState.elapsedOffset,
          lastUpdate: translatedState.lastUpdate,
          snapshotTs,
          firebaseTs,
        })
      }
      const activeTimer = activeId ? timers.find((timer) => timer.id === activeId) : undefined
      if (isSnapshotStale(translatedState, snapshotTs, Date.now(), activeTimer)) {
        if (debugCompanion) {
          console.info('[companion] snapshot stale, ignoring', {
            roomId: payload.roomId,
            age: Date.now() - snapshotTs,
            isRunning: translatedState.isRunning,
          })
        }
        removePendingSyncRoom(payload.roomId)
        setRoomAuthority((prev) => ({
          ...prev,
          [payload.roomId]: {
            source: 'cloud',
            status: 'ready',
            lastSyncAt: Date.now(),
          },
        }))
        return
      }

      setCompanionRooms((prev) => ({
        ...prev,
        [payload.roomId]: {
          activeTimerId: payload.state.activeTimerId ?? null,
          isRunning: payload.state.isRunning ?? false,
          currentTime: payload.state.currentTime ?? 0,
          lastUpdate: payload.state.lastUpdate ?? snapshotTs,
          activeLiveCueId: payload.state.activeLiveCueId,
        },
      }))

      const subscription = subscribedRoomsRef.current[payload.roomId]
      if (subscription?.clientType === 'controller' && pendingSyncRoomsRef.current.has(payload.roomId)) {
        emitSyncRoomState(payload.roomId)
        removePendingSyncRoom(payload.roomId)
      }

      setRoomAuthority((prev) => ({
        ...prev,
        [payload.roomId]: {
          source: 'companion',
          status: 'ready',
          lastSyncAt: Date.now(),
        },
      }))

      if (debugCompanion) {
        console.info('[companion] ROOM_STATE_SNAPSHOT', {
          roomId: payload.roomId,
          lastUpdate: payload.state.lastUpdate,
        })
      }

      replayRoomQueue(payload.roomId, snapshotTs)
    }

    const handleRoomStateDelta = (payload: RoomStateDeltaPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      const incomingTs = payload.changes.lastUpdate ?? payload.timestamp ?? Date.now()
      const existingTs = companionRoomsRef.current[payload.roomId]?.lastUpdate ?? 0
      const firebaseTs = firebase.getRoom(payload.roomId)?.state.lastUpdate ?? 0
      const isStale =
        incomingTs + confidenceWindowMs < existingTs ||
        incomingTs + confidenceWindowMs < firebaseTs
      if (import.meta.env.DEV) {
        const activeId =
          payload.changes.activeTimerId ??
          companionRoomsRef.current[payload.roomId]?.activeTimerId ??
          null
        console.info('[UData] ROOM_STATE_DELTA', {
          roomId: payload.roomId,
          activeId,
          currentTime: payload.changes.currentTime,
          lastUpdate: payload.changes.lastUpdate,
          incomingTs,
          existingTs,
          firebaseTs,
        })
      }
      if (isStale) {
        if (debugCompanion) {
          console.info('[companion] stale update ignored', {
            roomId: payload.roomId,
            incomingTs,
            existingTs,
            firebaseTs,
          })
        }
        return
      }
      setCompanionRooms((prev) => {
        const existing = prev[payload.roomId] ?? buildDefaultCompanionState()
        const next: CompanionRoomState = {
          ...existing,
          ...payload.changes,
          currentTime:
            payload.changes.currentTime ?? existing.currentTime ?? 0,
          lastUpdate:
            payload.changes.lastUpdate ?? incomingTs,
        }
        return { ...prev, [payload.roomId]: next }
      })

      if (pendingSyncRoomsRef.current.has(payload.roomId)) {
        removePendingSyncRoom(payload.roomId)
      }

      setRoomAuthority((prev) => ({
        ...prev,
        [payload.roomId]: {
          source: 'companion',
          status: 'ready',
          lastSyncAt: Date.now(),
        },
      }))

      if (debugCompanion) {
        console.info('[companion] ROOM_STATE_DELTA', {
          roomId: payload.roomId,
          changes: payload.changes,
        })
      }

      replayRoomQueue(payload.roomId, incomingTs)
    }

    const handleTimerCreated = (payload: TimerCreatedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = [...(prev[payload.roomId] ?? [])]
        const filtered = list.filter((timer) => timer.id !== payload.timer.id)
        return {
          ...prev,
          [payload.roomId]: [...filtered, payload.timer].sort((a, b) => a.order - b.order),
        }
      })
    }

    const handleTimerUpdated = (payload: TimerUpdatedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        return {
          ...prev,
          [payload.roomId]: list
            .map((timer) =>
              timer.id === payload.timerId ? { ...timer, ...(payload.changes as Partial<Timer>) } : timer,
            )
            .sort((a, b) => a.order - b.order),
        }
      })
    }

    const handleTimerDeleted = (payload: TimerDeletedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        return { ...prev, [payload.roomId]: list.filter((timer) => timer.id !== payload.timerId) }
      })
    }

    const handleTimersReordered = (payload: TimersReorderedPayload) => {
      if (payload.clientId && payload.clientId === clientId) return
      setCompanionTimers((prev) => {
        const list = prev[payload.roomId] ?? []
        const byId = new Map(list.map((timer) => [timer.id, timer] as const))
        const ordered: Timer[] = []
        payload.timerIds.forEach((id, idx) => {
          const timer = byId.get(id)
          if (!timer) return
          ordered.push({ ...timer, order: (idx + 1) * 10 })
          byId.delete(id)
        })
        const remainder = [...byId.values()].sort((a, b) => a.order - b.order)
        return { ...prev, [payload.roomId]: [...ordered, ...remainder] }
      })
    }

    const handleTimerError = (payload: unknown) => {
      console.warn('[UnifiedDataContext] TIMER_ERROR', payload)
    }

    const writeLiveCueThrough = async (
      roomId: string,
      record: LiveCueRecord,
      activeCueId?: string | null,
      action: 'upsert' | 'delete' = 'upsert',
    ) => {
      const writeSource = resolveLiveCueWriteSource(roomId)
      if (!writeSource) return
      const rateLimited = recordLiveCueRate(roomId, record.updatedAt)
      if (activeCueId !== undefined) {
        void writeActiveLiveCueId(roomId, activeCueId)
      }
      if (rateLimited) return
      const recordForWrite = { ...record, source: writeSource }
      if (action === 'delete') {
        void deleteLiveCueFromFirestore(roomId, recordForWrite.cue.id)
        return
      }
      void writeLiveCueToFirestore(roomId, recordForWrite)
    }

    const handleLiveCueUpsert = (payload: LiveCueEventPayload) => {
      if (!canUseLiveCues(payload.roomId)) return
      const updatedAt = payload.timestamp ?? Date.now()
      if (debugCompanion) {
        console.info('[companion] LIVE_CUE_UPSERT', {
          roomId: payload.roomId,
          cueId: payload.cue.id,
          updatedAt,
          videoCount: payload.cue.metadata?.videos?.length ?? 0,
        })
      }
      const record: LiveCueRecord = {
        cue: payload.cue,
        updatedAt,
        source: 'companion',
      }
      upsertCompanionLiveCue(payload.roomId, record)
      setCompanionActiveLiveCueId(payload.roomId, payload.cue.id)
      void writeLiveCueThrough(payload.roomId, record, payload.cue.id, 'upsert')
    }

    const handleLiveCueEnded = (payload: LiveCueEventPayload) => {
      if (!canUseLiveCues(payload.roomId)) return
      const updatedAt = payload.timestamp ?? Date.now()
      const record: LiveCueRecord = {
        cue: payload.cue,
        updatedAt,
        source: 'companion',
      }
      removeCompanionLiveCue(payload.roomId, payload.cue.id)
      const activeId = companionRoomsRef.current[payload.roomId]?.activeLiveCueId
      const nextActiveId = activeId === payload.cue.id ? null : undefined
      if (activeId === payload.cue.id) {
        setCompanionActiveLiveCueId(payload.roomId, null)
      }
      void writeLiveCueThrough(payload.roomId, record, nextActiveId, 'delete')
    }

    const handleLiveCueCreated = (payload: LiveCueEventPayload) => {
      handleLiveCueUpsert(payload)
    }

    const handleLiveCueUpdated = (payload: LiveCueEventPayload) => {
      if (payload.cue.status === 'ended') {
        handleLiveCueEnded(payload)
        return
      }
      handleLiveCueUpsert(payload)
    }

    const handlePresentationLoaded = (payload: PresentationEventPayload) => {
      handleLiveCueUpdated({ type: 'LIVE_CUE_UPDATED', roomId: payload.roomId, cue: payload.cue, timestamp: payload.timestamp })
    }

    const handlePresentationUpdate = (payload: PresentationEventPayload) => {
      handleLiveCueUpdated({ type: 'LIVE_CUE_UPDATED', roomId: payload.roomId, cue: payload.cue, timestamp: payload.timestamp })
    }

    const handlePresentationClear = () => {}

    const handleControllerLockState = (payload: ControllerLockStatePayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    const handleControlRequestReceived = (payload: ControlRequestReceivedPayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    const handleControlRequestDenied = (payload: ControlRequestDeniedPayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    const handleRoomPinState = (payload: RoomPinStatePayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    const handleRoomClientsState = (payload: RoomClientsStatePayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    const handleSocketError = (payload: ErrorPayload) => {
      applyControlPayload(payload, { broadcast: true })
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('HANDSHAKE_ERROR', handleHandshakeError)
    socket.on('HANDSHAKE_ACK', handleHandshakeAckQueue)
    socket.on('ROOM_STATE_SNAPSHOT', handleRoomStateSnapshot)
    socket.on('ROOM_STATE_DELTA', handleRoomStateDelta)
    socket.on('TIMER_CREATED', handleTimerCreated)
    socket.on('TIMER_UPDATED', handleTimerUpdated)
    socket.on('TIMER_DELETED', handleTimerDeleted)
    socket.on('TIMERS_REORDERED', handleTimersReordered)
    socket.on('TIMER_ERROR', handleTimerError)
    socket.on('LIVE_CUE_CREATED', handleLiveCueCreated)
    socket.on('LIVE_CUE_UPDATED', handleLiveCueUpdated)
    socket.on('LIVE_CUE_ENDED', handleLiveCueEnded)
    socket.on('PRESENTATION_LOADED', handlePresentationLoaded)
    socket.on('PRESENTATION_UPDATE', handlePresentationUpdate)
    socket.on('PRESENTATION_CLEAR', handlePresentationClear)
    socket.on('CONTROLLER_LOCK_STATE', handleControllerLockState)
    socket.on('CONTROL_REQUEST_RECEIVED', handleControlRequestReceived)
    socket.on('CONTROL_REQUEST_DENIED', handleControlRequestDenied)
    socket.on('ROOM_PIN_STATE', handleRoomPinState)
    socket.on('ROOM_CLIENTS_STATE', handleRoomClientsState)
    socket.on('ERROR', handleSocketError)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('HANDSHAKE_ERROR', handleHandshakeError)
      socket.off('HANDSHAKE_ACK', handleHandshakeAckQueue)
      socket.off('ROOM_STATE_SNAPSHOT', handleRoomStateSnapshot)
      socket.off('ROOM_STATE_DELTA', handleRoomStateDelta)
      socket.off('TIMER_CREATED', handleTimerCreated)
      socket.off('TIMER_UPDATED', handleTimerUpdated)
      socket.off('TIMER_DELETED', handleTimerDeleted)
      socket.off('TIMERS_REORDERED', handleTimersReordered)
      socket.off('TIMER_ERROR', handleTimerError)
      socket.off('LIVE_CUE_CREATED', handleLiveCueCreated)
      socket.off('LIVE_CUE_UPDATED', handleLiveCueUpdated)
      socket.off('LIVE_CUE_ENDED', handleLiveCueEnded)
      socket.off('PRESENTATION_LOADED', handlePresentationLoaded)
      socket.off('PRESENTATION_UPDATE', handlePresentationUpdate)
      socket.off('PRESENTATION_CLEAR', handlePresentationClear)
      socket.off('CONTROLLER_LOCK_STATE', handleControllerLockState)
      socket.off('CONTROL_REQUEST_RECEIVED', handleControlRequestReceived)
      socket.off('CONTROL_REQUEST_DENIED', handleControlRequestDenied)
      socket.off('ROOM_PIN_STATE', handleRoomPinState)
      socket.off('ROOM_CLIENTS_STATE', handleRoomClientsState)
      socket.off('ERROR', handleSocketError)
    }
  }, [
    addPendingSyncRoom,
    applyControlPayload,
    canUseLiveCues,
    clientId,
    deleteLiveCueFromFirestore,
    clearPendingSyncRooms,
    clearToken,
    confidenceWindowMs,
    debugCompanion,
    effectiveMode,
    enqueueJoin,
    emitSyncRoomState,
    fetchToken,
    processJoinQueue,
    recordLiveCueRate,
    removeCompanionLiveCue,
    removePendingSyncRoom,
    resolveLiveCueWriteSource,
    setCompanionActiveLiveCueId,
    upsertCompanionLiveCue,
    writeActiveLiveCueId,
    writeLiveCueToFirestore,
    replayRoomQueue,
    socket,
    firebase,
    token,
  ])

  useEffect(() => {
    if (effectiveMode !== 'local') return
    Object.entries(subscribedRooms).forEach(([roomId, sub]) => {
      if (sub.clientType !== 'controller') return
      addPendingSyncRoom(roomId)
      setRoomAuthority((prev) => ({
        ...prev,
        [roomId]: {
          source: 'pending',
          status: 'syncing',
          lastSyncAt: Date.now(),
        },
      }))
    })
  }, [addPendingSyncRoom, effectiveMode, subscribedRooms])

  useEffect(() => {
    if (!isCompanionLive()) return
    Object.entries(subscribedRoomsRef.current).forEach(([roomId, subscription]) => {
      if (subscription?.clientType !== 'controller') return
      const firebaseRoom = firebase.getRoom(roomId)
      const companionState = companionRoomsRef.current[roomId]
      if (!firebaseRoom || !companionState) return
      const firebaseTs = firebaseRoom.state.lastUpdate ?? 0
      const companionTs = companionState.lastUpdate ?? 0
      if (firebaseTs > companionTs + confidenceWindowMs) {
        emitSyncRoomState(roomId)
      }
    })
  }, [companionRooms, confidenceWindowMs, emitSyncRoomState, firebase, isCompanionLive])

  const pickSource = useCallback(
    (roomId: string, firebaseTs: number, companionTs: number, authority: RoomAuthority) => {
      const viewerSyncGuard = authority.status === 'syncing' && isViewerClient(roomId)
      const lastControllerWrite = lastControllerWriteRef.current[roomId]
      const controllerTieBreaker =
        lastControllerWrite && Date.now() - lastControllerWrite.timestamp <= confidenceWindowMs
          ? lastControllerWrite.source
          : undefined
      return resolveRoomSource({
        isCompanionLive: isCompanionLive(),
        viewerSyncGuard,
        firebaseTs,
        companionTs,
        authoritySource: authority.source,
        mode,
        effectiveMode,
        confidenceWindowMs,
        controllerTieBreaker,
      })
    },
    [confidenceWindowMs, effectiveMode, isCompanionLive, isViewerClient, mode],
  )

  const getRoom = useCallback(
    (roomId: string) => {
      const authority = roomAuthority[roomId] ?? DEFAULT_AUTHORITY
      const cached = cachedSnapshotsRef.current[roomId]
      const firebaseRoom = firebase.getRoom(roomId)
      const cachedRoom = cached?.room

      // Helper to merge cached progress into a room, giving priority to cached values
      // This ensures bonus time (negative elapsed) and other progress is preserved
      const mergeProgressFromCache = (room: Room): Room => {
        const cachedProgress = cachedRoom?.state.progress ?? {}
        const hasCachedProgress = Object.keys(cachedProgress).length > 0
        if (!hasCachedProgress) return room
        // Use shared mergeProgress helper (cached values take priority)
        const roomProgress = room.state.progress ?? {}
        return {
          ...room,
          state: {
            ...room.state,
            progress: mergeProgress(roomProgress, cachedProgress),
          },
        }
      }

      if (!isCompanionLive()) {
        if (firebaseRoom) return mergeProgressFromCache(firebaseRoom)
        return cachedRoom
      }

      const companionState = companionRooms[roomId]
      if (!companionState) {
        if (firebaseRoom) return mergeProgressFromCache(firebaseRoom)
        return cachedRoom
      }
      if (!firebaseRoom) return buildRoomFromCompanion(roomId, companionState, cachedRoom)

      const firebaseTs = firebaseRoom.state.lastUpdate ?? 0
      const companionTs = companionState.lastUpdate ?? 0
      const source = pickSource(roomId, firebaseTs, companionTs, authority)
      if (debugCompanion) {
        console.info('[companion] pickSource', {
          roomId,
          source,
          firebaseTs,
          companionTs,
          authority: authority.source,
        })
      }
      if (source === 'companion') {
        // Merge cached progress into the companion-built room
        const companionRoom = buildRoomFromCompanion(roomId, companionState, firebaseRoom)
        return mergeProgressFromCache(companionRoom)
      }
      return mergeProgressFromCache(firebaseRoom)
    },
    [companionRooms, firebase, isCompanionLive, pickSource, roomAuthority],
  )

  const getTimers = useCallback(
    (roomId: string) => {
      const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
      const firebaseTimers = firebase.getTimers(roomId)

      // If not using companion for this room, always use Firebase timers
      if (!shouldUseCompanion(roomId)) {
        return firebaseTimers.length > 0 ? firebaseTimers : cached
      }

      // Using companion mode - merge Firebase and companion timers
      // Prefer Firebase timers if they exist (they have the authoritative duration/title)
      // But fall back to companion/cached if Firebase hasn't loaded
      const compTimers = companionTimers[roomId]
      if (firebaseTimers.length > 0) {
        // Use Firebase timer data as source of truth for duration/title
        return firebaseTimers
      }
      if (compTimers && compTimers.length > 0) {
        return [...compTimers].sort((a, b) => a.order - b.order)
      }
      return cached
    },
    [companionTimers, firebase, shouldUseCompanion],
  )

  const getLiveCueRecords = useCallback(
    (roomId: string) => {
      if (!canUseLiveCues(roomId)) return []
      const firebaseRecords = firebase.getLiveCueRecords(roomId)
      const companionRecords = Object.values(companionLiveCues[roomId] ?? {})
      if (!isCompanionLive() || !shouldUseCompanion(roomId)) {
        return firebaseRecords
      }

      const mergeCueVideos = (existing: LiveCueRecord, incoming: LiveCueRecord): LiveCueRecord => {
        const existingVideos = existing.cue.metadata?.videos ?? []
        const incomingVideos = incoming.cue.metadata?.videos ?? []
        if (incomingVideos.length > 0 || existingVideos.length === 0) return incoming
        return {
          ...incoming,
          cue: {
            ...incoming.cue,
            metadata: {
              ...incoming.cue.metadata,
              videos: existingVideos,
            },
          },
        }
      }

      const merged = new Map<string, LiveCueRecord>()
      companionRecords.forEach((record) => {
        merged.set(record.cue.id, record)
      })
      firebaseRecords.forEach((record) => {
        if (record.cue.source === 'powerpoint' && !merged.has(record.cue.id)) {
          return
        }
        const existing = merged.get(record.cue.id)
        if (!existing) {
          merged.set(record.cue.id, record)
          return
        }
        if (record.updatedAt > existing.updatedAt) {
          merged.set(record.cue.id, mergeCueVideos(existing, record))
          return
        }
        if (record.updatedAt < existing.updatedAt) return
        if (existing.source === 'companion' && record.source === 'controller') {
          merged.set(record.cue.id, mergeCueVideos(existing, record))
        }
      })

      return [...merged.values()]
    },
    [canUseLiveCues, companionLiveCues, firebase, isCompanionLive, shouldUseCompanion],
  )

  const getLiveCues = useCallback(
    (roomId: string) => getLiveCueRecords(roomId).map((record) => record.cue),
    [getLiveCueRecords],
  )

  const getLiveCueDiagnostics = useCallback(
    (roomId: string) => {
      const firebaseRecords = firebase.getLiveCueRecords(roomId)
      const companionRecords = Object.values(companionLiveCues[roomId] ?? {})
      return {
        canUseLiveCues: canUseLiveCues(roomId),
        isCompanionLive: isCompanionLive(),
        isSubscribed: shouldUseCompanion(roomId),
        firebaseCount: firebaseRecords.length,
        companionCount: companionRecords.length,
      }
    },
    [canUseLiveCues, companionLiveCues, firebase, isCompanionLive, shouldUseCompanion],
  )

  const setActiveTimer = useCallback<DataContextValue['setActiveTimer']>(
    async (roomId, timerId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot set active timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot set active timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'setActiveTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.setActiveTimer(roomId, timerId)
      }

      const room = getRoom(roomId)
      const now = Date.now()
      const state = ensureCompanionRoomState(roomId)
      const oldTimerId = state.activeTimerId
      const isSwitchingTimer = oldTimerId && oldTimerId !== timerId

      // Save old timer's progress before switching (including if it was running)
      if (isSwitchingTimer) {
        const oldElapsed = computeCompanionElapsed(state)
        // Update cached room's progress map
        const cached = cachedSnapshotsRef.current[roomId]
        if (cached?.room) {
          const updatedProgress = { ...(cached.room.state.progress ?? {}), [oldTimerId]: oldElapsed }
          cachedSnapshotsRef.current = {
            ...cachedSnapshotsRef.current,
            [roomId]: {
              ...cached,
              room: {
                ...cached.room,
                state: { ...cached.room.state, progress: updatedProgress },
              },
            },
          }
          persistRoomCache(cachedSnapshotsRef.current)
        }
      }

      const elapsedOffset = resolveElapsedForTimer(room, timerId)
      const nextState: CompanionRoomState = {
        ...state,
        activeTimerId: timerId,
        isRunning: false,
        currentTime: elapsedOffset,
        lastUpdate: now,
      }
      setCompanionRooms((prev) => ({ ...prev, [roomId]: nextState }))

      const patch: RoomStatePatchPayload = {
        type: 'ROOM_STATE_PATCH',
        roomId,
        changes: {
          activeTimerId: timerId,
          isRunning: false,
          currentTime: elapsedOffset,
          lastUpdate: now,
        },
        timestamp: now,
        clientId,
      }
      emitOrQueue(roomId, patch)

      if (firestore && canWriteThrough(roomId)) {
        await firebase.setActiveTimer(roomId, timerId)
      }
    },
    [
      canWriteThrough,
      clientId,
      computeCompanionElapsed,
      emitOrQueue,
      ensureCloudWriteAllowed,
      ensureCompanionRoomState,
      firebase,
      firestore,
      isLockedOut,
      markControllerWrite,
      getRoom,
      isViewerClient,
      resolveElapsedForTimer,
      shouldUseCompanion,
    ],
  )

  const nudgeTimer = useCallback<DataContextValue['nudgeTimer']>(
    async (roomId, deltaMs) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot nudge timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot nudge timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'nudgeTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.nudgeTimer(roomId, deltaMs)
      }

      const room = getRoom(roomId)
      const state = ensureCompanionRoomState(roomId)
      const activeTimerId = room?.state.activeTimerId ?? state.activeTimerId
      if (!activeTimerId) return

      // Adjust duration instead of elapsed - uses reliable timer sync path
      const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
      const companionList = companionTimersRef.current[roomId] ?? []
      const timers = companionList.length > 0 ? companionList : (cached.length > 0 ? cached : firebase.getTimers(roomId))
      const activeTimer = timers.find((t) => t.id === activeTimerId)

      if (activeTimer) {
        const deltaSec = Math.round(deltaMs / 1000)
        const newDuration = Math.max(0, activeTimer.duration + deltaSec)
        // Set originalDuration on first nudge so reset can restore it
        const originalDuration = activeTimer.originalDuration ?? activeTimer.duration
        const changes: Partial<Timer> = { duration: newDuration }
        if (activeTimer.originalDuration === undefined) {
          changes.originalDuration = originalDuration
        }

        // Update local companion timers
        setCompanionTimers((prev) => {
          const existing = prev[roomId] ?? []
          const list = existing.length > 0 ? existing : cached
          return {
            ...prev,
            [roomId]: list
              .map((timer) => (timer.id === activeTimerId ? { ...timer, ...changes } : timer))
              .sort((a, b) => a.order - b.order),
          }
        })

        // Emit UPDATE_TIMER to Companion (uses reliable timer sync path)
        emitOrQueue(roomId, {
          type: 'UPDATE_TIMER',
          roomId,
          timerId: activeTimerId,
          changes,
          timestamp: Date.now(),
          clientId,
        })

        // Write to Firebase
        if (firestore && canWriteThrough(roomId)) {
          const timerRef = doc(firestore, 'rooms', roomId, 'timers', activeTimerId)
          await setDoc(timerRef, { ...changes, updatedAt: Date.now() } as Record<string, unknown>, { merge: true }).catch(() => undefined)
        }
      }
    },
    [
      canWriteThrough,
      clientId,
      emitOrQueue,
      ensureCloudWriteAllowed,
      ensureCompanionRoomState,
      firebase,
      firestore,
      getRoom,
      isLockedOut,
      markControllerWrite,
      isViewerClient,
      shouldUseCompanion,
    ],
  )

  const createTimer = useCallback<DataContextValue['createTimer']>(
    async (roomId, input) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot create timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot create timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'createTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.createTimer(roomId, input)
      }

      const state = ensureCompanionRoomState(roomId)
      const title = input.title.trim()
      const duration = Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 1
      const timerId = crypto.randomUUID()

      const list = companionTimersRef.current[roomId] ?? []
      const nextOrder = list.length ? Math.max(...list.map((t) => t.order)) + 10 : 10
      const timer: Timer = {
        id: timerId,
        roomId,
        title,
        duration,
        speaker: input.speaker ?? '',
        type: 'countdown',
        order: nextOrder,
      }

      setCompanionTimers((prev) => {
        const nextTimer = { ...timer, order: nextOrder }
        return { ...prev, [roomId]: [...list, nextTimer].sort((a, b) => a.order - b.order) }
      })

      if (!state.activeTimerId) {
        setCompanionRooms((prev) => ({
          ...prev,
          [roomId]: {
            ...state,
            activeTimerId: timerId,
          },
        }))
      }

      emitOrQueue(roomId, {
        type: 'CREATE_TIMER',
        roomId,
        timer,
        timestamp: Date.now(),
        clientId,
      })

      if (firestore && canWriteThrough(roomId)) {
        const timerRef = doc(firestore, 'rooms', roomId, 'timers', timerId)
        await setDoc(timerRef, { ...timer, version: 1 } as Record<string, unknown>, { merge: true }).catch(
          () => undefined,
        )
      }

      return timer
    },
    [canWriteThrough, clientId, emitOrQueue, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const updateTimer = useCallback<DataContextValue['updateTimer']>(
    async (roomId, timerId, patch) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot update timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot update timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'updateTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.updateTimer(roomId, timerId, patch)
      }

      const state = ensureCompanionRoomState(roomId)
      const now = Date.now()

      setCompanionTimers((prev) => {
        // Use cached timers as base if companion timers don't exist yet
        const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
        const existing = prev[roomId]
        const list = existing && existing.length > 0 ? existing : cached
        return {
          ...prev,
          [roomId]: list
            .map((timer) => (timer.id === timerId ? { ...timer, ...(patch as Partial<Timer>) } : timer))
            .sort((a, b) => a.order - b.order),
        }
      })

      // When duration changes, reset progress to 0 (timer restarts from new duration)
      // If it's the active timer and running, keep it running from 0
      if (patch.duration !== undefined) {
        const isActiveTimer = state.activeTimerId === timerId
        const wasRunning = state.isRunning

        // Update cached room's progress map
        const cached = cachedSnapshotsRef.current[roomId]
        if (cached?.room) {
          const updatedProgress = { ...(cached.room.state.progress ?? {}), [timerId]: 0 }
          const updatedState = isActiveTimer
            ? {
                ...cached.room.state,
                progress: updatedProgress,
                elapsedOffset: 0,
                startedAt: wasRunning ? now : null,
                currentTime: 0,
                lastUpdate: now,
              }
            : { ...cached.room.state, progress: updatedProgress }
          cachedSnapshotsRef.current = {
            ...cachedSnapshotsRef.current,
            [roomId]: {
              ...cached,
              room: { ...cached.room, state: updatedState },
            },
          }
          persistRoomCache(cachedSnapshotsRef.current)
        }

        // If it's the active timer, update companion state (reset to 0, keep running if was running)
        if (isActiveTimer) {
          setCompanionRooms((prev) => ({
            ...prev,
            [roomId]: {
              ...state,
              currentTime: 0,
              lastUpdate: now,
              // Keep isRunning as-is so timer continues if it was running
            },
          }))

          // Emit state patch to companion
          const statePatch: RoomStatePatchPayload = {
            type: 'ROOM_STATE_PATCH',
            roomId,
            changes: {
              activeTimerId: timerId,
              isRunning: wasRunning,
              currentTime: 0,
              lastUpdate: now,
            },
            timestamp: now,
            clientId,
          }
          emitOrQueue(roomId, statePatch)
        }
      }

      emitOrQueue(roomId, {
        type: 'UPDATE_TIMER',
        roomId,
        timerId,
        changes: patch,
        timestamp: Date.now(),
        clientId,
      })

      if (firestore && canWriteThrough(roomId)) {
        const timerRef = doc(firestore, 'rooms', roomId, 'timers', timerId)
        await setDoc(timerRef, { ...patch, updatedAt: Date.now() } as Record<string, unknown>, { merge: true }).catch(
          () => undefined,
        )

        // Also update state if duration changed
        if (patch.duration !== undefined) {
          const stateRef = doc(firestore, 'rooms', roomId, 'state', 'current')
          const isActiveTimer = state.activeTimerId === timerId
          const stateUpdate: Record<string, unknown> = {
            [`progress.${timerId}`]: 0,
          }
          if (isActiveTimer) {
            stateUpdate.elapsedOffset = 0
            stateUpdate.startedAt = state.isRunning ? now : null
            stateUpdate.currentTime = 0
            stateUpdate.lastUpdate = now
          }
          await setDoc(stateRef, stateUpdate, { merge: true }).catch(() => undefined)
        }
      }
    },
    [canWriteThrough, clientId, emitOrQueue, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const deleteTimer = useCallback<DataContextValue['deleteTimer']>(
    async (roomId, timerId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot delete timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot delete timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'deleteTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.deleteTimer(roomId, timerId)
      }

      ensureCompanionRoomState(roomId)

      // Use cached timers as base if companion timers don't exist yet
      const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
      const existingTimers = companionTimersRef.current[roomId]
      const baseTimers = existingTimers && existingTimers.length > 0 ? existingTimers : cached
      const remainingTimers = baseTimers.filter((timer) => timer.id !== timerId)

      setCompanionTimers((prev) => {
        return { ...prev, [roomId]: remainingTimers }
      })

      setCompanionRooms((prev) => {
        const state = prev[roomId] ?? buildDefaultCompanionState()
        if (state.activeTimerId !== timerId) return prev
        return {
          ...prev,
          [roomId]: {
            ...state,
            activeTimerId: remainingTimers[0]?.id ?? null,
            isRunning: remainingTimers.length ? state.isRunning : false,
            currentTime: remainingTimers.length ? state.currentTime : 0,
            lastUpdate: Date.now(),
          },
        }
      })

      emitOrQueue(roomId, {
        type: 'DELETE_TIMER',
        roomId,
        timerId,
        timestamp: Date.now(),
        clientId,
      })

      if (firestore && canWriteThrough(roomId)) {
        const timerRef = doc(firestore, 'rooms', roomId, 'timers', timerId)
        await deleteDoc(timerRef).catch(() => undefined)
      }
    },
    [canWriteThrough, clientId, emitOrQueue, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const reorderTimer = useCallback<DataContextValue['reorderTimer']>(
    async (roomId, timerId, targetIndex) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot reorder timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot reorder timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'reorderTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.reorderTimer(roomId, timerId, targetIndex)
      }

      ensureCompanionRoomState(roomId)

      // Use cached timers as base if companion timers don't exist yet
      const cached = cachedSnapshotsRef.current[roomId]?.timers ?? []
      const existingTimers = companionTimersRef.current[roomId]
      const baseTimers = existingTimers && existingTimers.length > 0 ? existingTimers : cached
      const ordered = [...baseTimers].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
      if (fromIndex === -1) return
      const [moved] = ordered.splice(fromIndex, 1)
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
      ordered.splice(clampedIndex, 0, moved)
      const next = ordered.map((timer, idx) => ({ ...timer, order: (idx + 1) * 10 }))

      setCompanionTimers((prev) => ({ ...prev, [roomId]: next }))

      emitOrQueue(roomId, {
        type: 'REORDER_TIMERS',
        roomId,
        timerIds: next.map((timer) => timer.id),
        timestamp: Date.now(),
        clientId,
      })

      if (firestore && canWriteThrough(roomId)) {
        const batch = writeBatch(firestore)
        next.forEach((timer) => {
          batch.set(doc(firestore, 'rooms', roomId, 'timers', timer.id), { order: timer.order } as Record<string, unknown>, {
            merge: true,
          })
        })
        await batch.commit().catch(() => undefined)
      }
    },
    [canWriteThrough, clientId, emitOrQueue, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const moveTimer = useCallback(
    async (roomId: string, timerId: string, direction: 'up' | 'down') => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot move timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot move timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!firebase.moveTimer) return
        if (!ensureCloudWriteAllowed(roomId, 'moveTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.moveTimer(roomId, timerId, direction)
      }
      const ordered = [...(companionTimersRef.current[roomId] ?? [])].sort((a, b) => a.order - b.order)
      const fromIndex = ordered.findIndex((timer) => timer.id === timerId)
      if (fromIndex === -1) return
      const targetIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1
      return reorderTimer(roomId, timerId, targetIndex)
    },
    [ensureCloudWriteAllowed, firebase, isLockedOut, markControllerWrite, isViewerClient, reorderTimer, shouldUseCompanion],
  )

  const emitTimerAction = useCallback(
    (roomId: string, timerId: string, action: 'START' | 'PAUSE' | 'RESET', currentTimeMs?: number) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot control timers', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot control timers', roomId)
        return
      }
      const timestamp = Date.now()
      const payload: QueuedEvent = {
        type: 'TIMER_ACTION',
        action,
        roomId,
        timerId,
        timestamp,
        clientId,
        ...(typeof currentTimeMs === 'number' && { currentTime: currentTimeMs }),
      }
      emitOrQueue(roomId, payload)

      if (firestore && canWriteThrough(roomId)) {
        const stateRefV2 = doc(firestore, 'rooms', roomId, 'state', 'current')
        const legacyRef = doc(firestore, 'rooms', roomId)

        // Use passed currentTimeMs if available, otherwise compute from state
        // This avoids stale state issues when called right after setCompanionRooms
        const state = ensureCompanionRoomState(roomId)
        const currentElapsed = typeof currentTimeMs === 'number' ? currentTimeMs : computeCompanionElapsed(state)
        const stateUpdate: Record<string, unknown> = {
          activeTimerId: timerId,
          isRunning: action === 'START',
          lastUpdate: timestamp,
        }

        if (action === 'START') {
          stateUpdate.startedAt = timestamp
          stateUpdate.elapsedOffset = currentElapsed
          stateUpdate.currentTime = currentElapsed
        } else if (action === 'PAUSE') {
          stateUpdate.startedAt = null
          stateUpdate.elapsedOffset = currentElapsed
          stateUpdate.currentTime = currentElapsed
          // Also update progress map for the paused timer
          stateUpdate[`progress.${timerId}`] = currentElapsed
        } else if (action === 'RESET') {
          stateUpdate.startedAt = null
          stateUpdate.elapsedOffset = 0
          stateUpdate.currentTime = 0
          // Also update progress map for the reset timer
          stateUpdate[`progress.${timerId}`] = 0
        }

        void setDoc(stateRefV2, stateUpdate, { merge: true }).catch(() => {
          const legacyPayload: Record<string, unknown> = {}
          if (stateUpdate.activeTimerId !== undefined) legacyPayload['state.activeTimerId'] = stateUpdate.activeTimerId
          if (stateUpdate.isRunning !== undefined) legacyPayload['state.isRunning'] = stateUpdate.isRunning
          if (stateUpdate.lastUpdate !== undefined) legacyPayload['state.lastUpdate'] = stateUpdate.lastUpdate
          if (stateUpdate.currentTime !== undefined) legacyPayload['state.currentTime'] = stateUpdate.currentTime
          if (stateUpdate.startedAt !== undefined) legacyPayload['state.startedAt'] = stateUpdate.startedAt
          if (stateUpdate.elapsedOffset !== undefined) legacyPayload['state.elapsedOffset'] = stateUpdate.elapsedOffset
          return setDoc(legacyRef, legacyPayload, { merge: true }).catch(() => undefined)
        })
      }
    },
    [canWriteThrough, clientId, computeCompanionElapsed, emitOrQueue, ensureCompanionRoomState, firestore, isLockedOut, isViewerClient],
  )

  const startTimer = useCallback<DataContextValue['startTimer']>(
    async (roomId, timerId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot start timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot start timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'startTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.startTimer(roomId, timerId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = timerId ?? state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()
      // If switching to a different timer, use its stored progress (from progress map).
      // If resuming the same timer, preserve the current elapsed time.
      const isSwitchingTimer = targetId !== state.activeTimerId
      const room = getRoom(roomId)

      // Save old timer's progress before switching
      const oldTimerId = state.activeTimerId
      if (isSwitchingTimer && oldTimerId) {
        const oldElapsed = computeCompanionElapsed(state)
        // Update cached room's progress map
        const cached = cachedSnapshotsRef.current[roomId]
        if (cached?.room) {
          const updatedProgress = { ...(cached.room.state.progress ?? {}), [oldTimerId]: oldElapsed }
          cachedSnapshotsRef.current = {
            ...cachedSnapshotsRef.current,
            [roomId]: {
              ...cached,
              room: {
                ...cached.room,
                state: { ...cached.room.state, progress: updatedProgress },
              },
            },
          }
          persistRoomCache(cachedSnapshotsRef.current)
        }
        // Write through to Firebase
        if (firestore && canWriteThrough(roomId)) {
          const stateRef = doc(firestore, 'rooms', roomId, 'state', 'current')
          void setDoc(stateRef, { progress: { [oldTimerId]: oldElapsed } }, { merge: true }).catch(() => undefined)
        }
      }

      const elapsed = isSwitchingTimer
        ? resolveElapsedForTimer(room, targetId)
        : computeCompanionElapsed(state)
      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: true,
          currentTime: elapsed,
          lastUpdate: now,
        },
      }))
      emitTimerAction(roomId, targetId, 'START', elapsed)
    },
    [canWriteThrough, computeCompanionElapsed, emitTimerAction, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, getRoom, isLockedOut, markControllerWrite, isViewerClient, resolveElapsedForTimer, shouldUseCompanion],
  )

  const pauseTimer = useCallback<DataContextValue['pauseTimer']>(
    async (roomId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot pause timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot pause timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'pauseTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.pauseTimer(roomId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()
      const elapsed = computeCompanionElapsed(state)

      // Update cache's progress map with current elapsed time
      const cached = cachedSnapshotsRef.current[roomId]
      if (cached?.room) {
        const updatedProgress = { ...(cached.room.state.progress ?? {}), [targetId]: elapsed }
        cachedSnapshotsRef.current = {
          ...cachedSnapshotsRef.current,
          [roomId]: {
            ...cached,
            room: {
              ...cached.room,
              state: { ...cached.room.state, progress: updatedProgress },
            },
          },
        }
        persistRoomCache(cachedSnapshotsRef.current)
      }

      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: false,
          currentTime: elapsed,
          lastUpdate: now,
        },
      }))
      // Pass elapsed time to emitTimerAction to avoid stale state issue
      emitTimerAction(roomId, targetId, 'PAUSE', elapsed)
    },
    [computeCompanionElapsed, emitTimerAction, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const resetTimer = useCallback<DataContextValue['resetTimer']>(
    async (roomId) => {
      if (isViewerClient(roomId)) {
        console.warn('[UnifiedDataContext] viewer cannot reset timer', roomId)
        return
      }
      if (isLockedOut(roomId)) {
        console.warn('[UnifiedDataContext] controller locked; cannot reset timer', roomId)
        return
      }
      if (!shouldUseCompanion(roomId)) {
        if (!ensureCloudWriteAllowed(roomId, 'resetTimer')) return
        markControllerWrite(roomId, 'cloud')
        return firebase.resetTimer(roomId)
      }
      const state = ensureCompanionRoomState(roomId)
      const list = companionTimersRef.current[roomId] ?? []
      const targetId = state.activeTimerId ?? list[0]?.id
      if (!targetId) return
      const now = Date.now()

      // Update cache's progress map to reset timer to 0
      const cached = cachedSnapshotsRef.current[roomId]
      if (cached?.room) {
        const updatedProgress = { ...(cached.room.state.progress ?? {}), [targetId]: 0 }
        cachedSnapshotsRef.current = {
          ...cachedSnapshotsRef.current,
          [roomId]: {
            ...cached,
            room: {
              ...cached.room,
              state: { ...cached.room.state, progress: updatedProgress },
            },
          },
        }
        persistRoomCache(cachedSnapshotsRef.current)
      }

      setCompanionRooms((prev) => ({
        ...prev,
        [roomId]: {
          ...state,
          activeTimerId: targetId,
          isRunning: false,
          currentTime: 0,
          lastUpdate: now,
        },
      }))
      emitTimerAction(roomId, targetId, 'RESET', 0)

      // Restore duration to originalDuration if it was adjusted by nudge
      const timers = list.length > 0 ? list : (cached?.timers ?? firebase.getTimers(roomId))
      const activeTimer = timers.find((t) => t.id === targetId)
      if (activeTimer?.originalDuration !== undefined && activeTimer.duration !== activeTimer.originalDuration) {
        const restoredDuration = activeTimer.originalDuration
        // Update local companion timers
        setCompanionTimers((prev) => {
          const existing = prev[roomId] ?? []
          return {
            ...prev,
            [roomId]: existing
              .map((timer) => (timer.id === targetId ? { ...timer, duration: restoredDuration, originalDuration: undefined } : timer))
              .sort((a, b) => a.order - b.order),
          }
        })
        // Emit UPDATE_TIMER to Companion
        emitOrQueue(roomId, {
          type: 'UPDATE_TIMER',
          roomId,
          timerId: targetId,
          changes: { duration: restoredDuration },
          timestamp: now,
          clientId,
        })
        // Write to Firebase
        if (firestore && canWriteThrough(roomId)) {
          const timerRef = doc(firestore, 'rooms', roomId, 'timers', targetId)
          await setDoc(timerRef, { duration: restoredDuration, updatedAt: now } as Record<string, unknown>, { merge: true }).catch(() => undefined)
          // Clear originalDuration in Firebase
          await updateDoc(timerRef, { originalDuration: deleteField() }).catch(() => undefined)
        }
      }
    },
    [canWriteThrough, clientId, emitOrQueue, emitTimerAction, ensureCloudWriteAllowed, ensureCompanionRoomState, firebase, firestore, isLockedOut, markControllerWrite, isViewerClient, shouldUseCompanion],
  )

  const value = useMemo<UnifiedDataContextValue>(
    () => {
      const mergedRoomsMap = new Map<string, Room>()
      ;(firebase.rooms ?? []).forEach((room) => mergedRoomsMap.set(room.id, room))
      Object.values(cachedSnapshots).forEach((entry) => {
        if (!mergedRoomsMap.has(entry.roomId)) {
          mergedRoomsMap.set(entry.roomId, entry.room)
        }
      })
      return {
        ...firebase,
        rooms: [...mergedRoomsMap.values()],
        queueStatus,
        getRoom,
        getTimers,
        getLiveCues,
        getLiveCueRecords,
        getLiveCueDiagnostics,
        createTimer,
        updateTimer,
        deleteTimer,
        reorderTimer,
        moveTimer,
        setActiveTimer,
        startTimer,
        pauseTimer,
        resetTimer,
        nudgeTimer,
        roomAuthority,
        getRoomAuthority,
        forceCloudAuthority,
        forceCompanionAuthority,
        controllerLocks,
        roomPins,
        roomClients,
        controlRequests,
        pendingControlRequests,
        controlDenials,
        controlDisplacements,
        controlErrors,
        getControllerLock,
        getControllerLockState,
        getRoomPin,
        setRoomPin,
        requestControl,
        forceTakeover,
        handOverControl,
        denyControl,
        sendHeartbeat,
        subscribeToCompanionRoom,
        unsubscribeFromCompanionRoom,
      }
    },
    [
      cachedSnapshots,
      controllerLocks,
      roomPins,
      roomClients,
      controlRequests,
      pendingControlRequests,
      controlDenials,
      controlDisplacements,
      controlErrors,
      createTimer,
      deleteTimer,
      firebase,
      forceCloudAuthority,
      forceCompanionAuthority,
      forceTakeover,
      getRoom,
      getRoomAuthority,
      getControllerLock,
      getControllerLockState,
      getRoomPin,
      getTimers,
      getLiveCues,
      getLiveCueDiagnostics,
      getLiveCueRecords,
      denyControl,
      handOverControl,
      moveTimer,
      nudgeTimer,
      pauseTimer,
      queueStatus,
      reorderTimer,
      resetTimer,
      requestControl,
      roomAuthority,
      sendHeartbeat,
      setActiveTimer,
      setRoomPin,
      startTimer,
      subscribeToCompanionRoom,
      unsubscribeFromCompanionRoom,
      updateTimer,
    ],
  )

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}

export const UnifiedDataProvider = ({
  children,
  fallbackToMock = false,
}: {
  children: ReactNode
  fallbackToMock?: boolean
}) => (
  <FirebaseDataProvider fallbackToMock={fallbackToMock}>
    <UnifiedDataResolver>{children}</UnifiedDataResolver>
  </FirebaseDataProvider>
)

export const useUnifiedDataContext = () => useDataContext() as UnifiedDataContextValue
