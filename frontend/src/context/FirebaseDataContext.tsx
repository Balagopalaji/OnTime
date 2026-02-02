import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type FirestoreError,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { MessageColor, Room, Timer, LiveCue, LiveCueRecord, Cue, Section, Segment, ControllerClient } from '../types'
import { DataProviderBoundary, type DataContextValue, type RoomPinMeta } from './DataContext'
import { computeProgress as computeProgressUtil, type FirebaseTimerState } from '../utils/timer-utils'
import { MockDataProvider } from './MockDataContext'
import { useAuth } from './AuthContext'
import { doc as firestoreDoc, updateDoc as updateDocFs } from 'firebase/firestore'
import { mapSection, mapSegment, stripUndefined, type SectionDoc, type SegmentDoc } from './firebase-data-utils'

const DEFAULT_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

const DEFAULT_FEATURES = {
  localMode: true,
  showControl: false,
  powerpoint: false,
  externalVideo: false,
}

const MIGRATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000


type RoomDoc = {
  title: string
  ownerId: string
  timezone: string
  order?: number
  createdAt: number | { seconds: number; nanoseconds: number }
  _version?: number
  config?: {
    warningSec?: number
    criticalSec?: number
  }
  state?: {
    activeTimerId?: string | null
    isRunning?: boolean
    startedAt?: number | null
    elapsedOffset?: number
    progress?: Record<string, number>
    showClock?: boolean
    clockMode?: '24h' | 'ampm'
    message?: {
      text?: string
      visible?: boolean
      color?: MessageColor
    }
    activeLiveCueId?: string
  }
}

type RoomStateDoc = {
  activeTimerId?: string | null
  isRunning?: boolean
  startedAt?: number | { seconds: number; nanoseconds: number }
  elapsedOffset?: number
  progress?: Record<string, number>
  showClock?: boolean
  clockMode?: '24h' | 'ampm'
  message?: {
    text?: string
    visible?: boolean
    color?: MessageColor
  }
  currentTime?: number
  lastUpdate?: number
  activeLiveCueId?: string
}

const toMillis = (val: unknown, fallback: number | null = null): number | null => {
  if (typeof val === 'number') return val
  if (val && typeof val === 'object' && 'seconds' in val) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (val as any).seconds * 1000
  }
  return fallback
}

const mapRoom = (id: string, data: RoomDoc): Room => {
  const startedAtMs = toMillis(data.state?.startedAt, null)
  const createdAtMs = toMillis(data.createdAt, Date.now()) ?? Date.now()
  const record = data as unknown as Record<string, unknown>
  const tier =
    record.tier === 'basic' || record.tier === 'show_control' || record.tier === 'production'
      ? record.tier
      : 'basic'
  const features = typeof record.features === 'object' && record.features
    ? (record.features as Record<string, unknown>)
    : null

  return {
    id,
    ownerId: data.ownerId,
    title: data.title,
    timezone: data.timezone,
    createdAt: createdAtMs,
    order: data.order ?? createdAtMs,
    config: {
      warningSec: data.config?.warningSec ?? DEFAULT_CONFIG.warningSec,
      criticalSec: data.config?.criticalSec ?? DEFAULT_CONFIG.criticalSec,
    },
    _version: data._version ?? 1,
    tier,
    features: features
      ? {
          localMode: features.localMode !== undefined ? Boolean(features.localMode) : DEFAULT_FEATURES.localMode,
          showControl: features.showControl !== undefined ? Boolean(features.showControl) : DEFAULT_FEATURES.showControl,
          powerpoint: features.powerpoint !== undefined ? Boolean(features.powerpoint) : DEFAULT_FEATURES.powerpoint,
          externalVideo: features.externalVideo !== undefined ? Boolean(features.externalVideo) : DEFAULT_FEATURES.externalVideo,
        }
      : DEFAULT_FEATURES,
    state: {
      activeTimerId: data.state?.activeTimerId ?? null,
      isRunning: data.state?.isRunning ?? false,
      startedAt: startedAtMs,
      elapsedOffset: data.state?.elapsedOffset ?? 0,
      progress: data.state?.progress ?? {},
      showClock: data.state?.showClock ?? false,
      clockMode: data.state?.clockMode ?? '24h',
      message: {
        text: data.state?.message?.text ?? '',
        visible: data.state?.message?.visible ?? false,
        color: data.state?.message?.color ?? 'green',
      },
      activeLiveCueId: data.state?.activeLiveCueId,
    },
  }
}

type TimerDoc = {
  title: string
  duration: number
  originalDuration?: number
  speaker?: string
  type: string
  order: number
  segmentId?: string
  segmentOrder?: number
}

const mapTimer = (id: string, roomId: string, data: TimerDoc): Timer => ({
  id,
  roomId,
  title: data.title,
  duration: data.duration,
  originalDuration: data.originalDuration,
  speaker: data.speaker ?? '',
  type: (data.type as Timer['type']) ?? 'countdown',
  order: data.order ?? 0,
  segmentId: typeof data.segmentId === 'string' ? data.segmentId : undefined,
  segmentOrder: typeof data.segmentOrder === 'number' ? data.segmentOrder : undefined,
})

type LiveCueDoc = {
  source?: string
  title?: string
  duration?: number
  startedAt?: number
  status?: string
  config?: {
    warningSec?: number
    criticalSec?: number
  }
  metadata?: Record<string, unknown>
  updatedAt?: number
  writeSource?: 'companion' | 'controller'
}

const mapLiveCue = (id: string, data: LiveCueDoc): LiveCue => {
  const source =
    data.source === 'powerpoint' || data.source === 'external_video' || data.source === 'pdf'
      ? data.source
      : 'powerpoint'
  const status = data.status === 'playing' || data.status === 'paused' || data.status === 'ended'
    ? data.status
    : undefined
  const metadata = data.metadata && typeof data.metadata === 'object'
    ? {
        slideNumber: typeof data.metadata.slideNumber === 'number' ? data.metadata.slideNumber : undefined,
        totalSlides: typeof data.metadata.totalSlides === 'number' ? data.metadata.totalSlides : undefined,
        slideNotes: typeof data.metadata.slideNotes === 'string' ? data.metadata.slideNotes : undefined,
        filename: typeof data.metadata.filename === 'string' ? data.metadata.filename : undefined,
        player: typeof data.metadata.player === 'string' ? data.metadata.player : undefined,
        parentTimerId: typeof data.metadata.parentTimerId === 'string' ? data.metadata.parentTimerId : undefined,
        autoAdvanceNext: typeof data.metadata.autoAdvanceNext === 'boolean' ? data.metadata.autoAdvanceNext : undefined,
        videoPlaying: typeof data.metadata.videoPlaying === 'boolean' ? data.metadata.videoPlaying : undefined,
        videoDuration: typeof data.metadata.videoDuration === 'number' ? data.metadata.videoDuration : undefined,
        videoElapsed: typeof data.metadata.videoElapsed === 'number' ? data.metadata.videoElapsed : undefined,
        videoRemaining: typeof data.metadata.videoRemaining === 'number' ? data.metadata.videoRemaining : undefined,
      }
    : undefined

  return {
    id,
    source,
    title: typeof data.title === 'string' ? data.title : '',
    duration: typeof data.duration === 'number' ? data.duration : undefined,
    startedAt: typeof data.startedAt === 'number' ? data.startedAt : undefined,
    status,
    config: data.config
      ? {
          warningSec: typeof data.config.warningSec === 'number' ? data.config.warningSec : undefined,
          criticalSec: typeof data.config.criticalSec === 'number' ? data.config.criticalSec : undefined,
        }
      : undefined,
    metadata,
  }
}

type CueDoc = {
  roomId?: string
  role?: string
  title?: string
  notes?: string
  sectionId?: string
  segmentId?: string
  order?: number
  triggerType?: string
  offsetMs?: number
  timeBase?: string
  targetTimeMs?: number
  afterCueId?: string
  approximatePosition?: number
  triggerNote?: string
  ackState?: string
  ackAt?: number
  ackBy?: string
  createdBy?: string
  createdAt?: number | { seconds: number; nanoseconds: number }
  updatedAt?: number | { seconds: number; nanoseconds: number }
  editedBy?: string
  createdByRole?: string
  editedByRole?: string
  editNote?: string
}

const mapCue = (id: string, roomId: string, data: CueDoc): Cue => {
  const createdAt = toMillis(data.createdAt, undefined)
  const updatedAt = toMillis(data.updatedAt, undefined)
  const role =
    data.role === 'lx' ||
    data.role === 'ax' ||
    data.role === 'vx' ||
    data.role === 'sm' ||
    data.role === 'foh' ||
    data.role === 'custom'
      ? data.role
      : 'custom'
  const triggerType =
    data.triggerType === 'timed' ||
    data.triggerType === 'fixed_time' ||
    data.triggerType === 'sequential' ||
    data.triggerType === 'follow' ||
    data.triggerType === 'floating'
      ? data.triggerType
      : 'timed'
  const ackState =
    data.ackState === 'pending' || data.ackState === 'done' || data.ackState === 'skipped'
      ? data.ackState
      : undefined
  const timeBase = data.timeBase === 'planned' ? 'planned' : data.timeBase === 'actual' ? 'actual' : undefined
  return {
    id,
    roomId,
    role,
    title: typeof data.title === 'string' ? data.title : '',
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    sectionId: typeof data.sectionId === 'string' ? data.sectionId : undefined,
    segmentId: typeof data.segmentId === 'string' ? data.segmentId : undefined,
    order: typeof data.order === 'number' ? data.order : undefined,
    triggerType,
    offsetMs: typeof data.offsetMs === 'number' ? data.offsetMs : undefined,
    timeBase,
    targetTimeMs: typeof data.targetTimeMs === 'number' ? data.targetTimeMs : undefined,
    afterCueId: typeof data.afterCueId === 'string' ? data.afterCueId : undefined,
    approximatePosition: typeof data.approximatePosition === 'number' ? data.approximatePosition : undefined,
    triggerNote: typeof data.triggerNote === 'string' ? data.triggerNote : undefined,
    ackState,
    ackAt: typeof data.ackAt === 'number' ? data.ackAt : undefined,
    ackBy: typeof data.ackBy === 'string' ? data.ackBy : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdAt: createdAt ?? undefined,
    updatedAt: updatedAt ?? undefined,
    editedBy: typeof data.editedBy === 'string' ? data.editedBy : undefined,
    createdByRole: data.createdByRole === 'custom' || data.createdByRole === 'lx' || data.createdByRole === 'ax' || data.createdByRole === 'vx' || data.createdByRole === 'sm' || data.createdByRole === 'foh'
      ? data.createdByRole
      : undefined,
    editedByRole: data.editedByRole === 'custom' || data.editedByRole === 'lx' || data.editedByRole === 'ax' || data.editedByRole === 'vx' || data.editedByRole === 'sm' || data.editedByRole === 'foh'
      ? data.editedByRole
      : undefined,
    editNote: typeof data.editNote === 'string' ? data.editNote : undefined,
  }
}

const roomOrderKey = (room: Pick<Room, 'order' | 'createdAt'>) => room.order ?? room.createdAt

// Use shared timer-utils for elapsed calculations
// IMPORTANT: No clamping - elapsed can be negative for bonus time
const computeProgress = (room: Room) => {
  const state: FirebaseTimerState = {
    isRunning: room.state.isRunning,
    startedAt: room.state.startedAt,
    elapsedOffset: room.state.elapsedOffset,
    activeTimerId: room.state.activeTimerId,
    progress: room.state.progress,
  }
  return computeProgressUtil(state)
}



export const FirebaseDataProvider = ({
  children,
  fallbackToMock = false,
}: {
  children: ReactNode
  fallbackToMock?: boolean
}) => {
  const [rooms, setRooms] = useState<Room[]>([])
  const [timers, setTimers] = useState<Record<string, Timer[]>>({})
  const [liveCueRecords, setLiveCueRecords] = useState<Record<string, LiveCueRecord[]>>({})
  const [cues, setCues] = useState<Record<string, Cue[]>>({})
  const [sections, setSections] = useState<Record<string, Section[]>>({})
  const [segments, setSegments] = useState<Record<string, Segment[]>>({})
  const [connectionStatus, setConnectionStatus] = useState<DataContextValue['connectionStatus']>(() =>
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  )
  const connectionStatusRef = useRef(connectionStatus)
  const setConnectionStatusFromSnapshot = useCallback((fromCache?: boolean) => {
    if (fromCache) {
      if (connectionStatusRef.current === 'reconnecting') return
      const online = typeof navigator !== 'undefined' && navigator.onLine
      setConnectionStatus(online ? 'reconnecting' : 'offline')
      return
    }
    setConnectionStatus('online')
  }, [])
  const [pendingRooms] = useState<Set<string>>(new Set())
  const [pendingRoomPlaceholders] = useState<
    Array<{ roomId: string; title: string; expiresAt: number; createdAt: number; order?: number }>
  >([])
  const [pendingTimers] = useState<Record<string, Set<string>>>({})
  const [pendingTimerPlaceholders] = useState<
    Record<string, Array<{ timerId: string; title: string; order: number; expiresAt: number }>>
  >({})
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0)
  const [stateOverrides, setStateOverrides] = useState<Record<string, Room['state']>>({})
  const pendingNudgeRef = useRef<Record<string, number>>({})
  const migratingRoomsRef = useRef<Set<string>>(new Set())

  const { user } = useAuth()
  const firestore = db

  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus('reconnecting')
      setSubscriptionEpoch((prev) => prev + 1)
    }
    const handleOffline = () => setConnectionStatus('offline')
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (connectionStatus === 'online') return
      setSubscriptionEpoch((prev) => prev + 1)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [connectionStatus])

  useEffect(() => {
    if (connectionStatus !== 'reconnecting') return undefined
    const interval = window.setInterval(() => {
      setSubscriptionEpoch((prev) => prev + 1)
    }, 10_000)
    return () => window.clearInterval(interval)
  }, [connectionStatus])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('ontime:cloud-status', { detail: connectionStatus }),
    )
  }, [connectionStatus])

  useEffect(() => {
    connectionStatusRef.current = connectionStatus
  }, [connectionStatus])

  useEffect(() => {
    if (fallbackToMock || !user || !firestore) return undefined
    const unsubscribe = onSnapshot(
      collection(firestore, 'rooms'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const next = snapshot.docs
          .map((docSnap) => mapRoom(docSnap.id, docSnap.data() as RoomDoc))
          .sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
        setRooms(next)
        next.forEach((room) => {
          console.info(`[firebase] room ${room.id} v${room._version ?? 1} tier=${room.tier ?? 'basic'}`)
        })
        next.forEach((room) => {
          pendingNudgeRef.current[room.id] = 0
        })
        setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
      },
      (error: FirestoreError) => {
        console.error('rooms snapshot error', error)
        setConnectionStatus('offline')
      },
    )
    return unsubscribe
  }, [fallbackToMock, firestore, setConnectionStatusFromSnapshot, subscriptionEpoch, user])

  useEffect(() => {
    if (fallbackToMock || !user || !firestore) return undefined
    const unsubs = rooms.map((room) => {
      const timersQuery = query(
        collection(firestore, 'rooms', room.id, 'timers'),
        orderBy('order', 'asc'),
      )
      const roomVersion = room._version ?? 1
      const stateDocRef = roomVersion === 2 ? firestoreDoc(firestore, 'rooms', room.id, 'state', 'current') : firestoreDoc(firestore, 'rooms', room.id)

      const stateUnsub = onSnapshot(
        stateDocRef,
        { includeMetadataChanges: true },
        (docSnap) => {
          if (!docSnap.exists()) return
          const raw = docSnap.data()
          if (!raw) return
          const statePayload =
            roomVersion === 2
              ? (raw as RoomStateDoc)
              : (((raw as RoomDoc).state ?? {}) as RoomStateDoc)

          if (import.meta.env.DEV) {
            const activeId = statePayload?.activeTimerId ?? room.state.activeTimerId ?? null
            const progress = statePayload?.progress ?? room.state.progress ?? {}
            console.info('[FirebaseDataContext] state snapshot', {
              roomId: room.id,
              activeId,
              elapsedOffset: statePayload?.elapsedOffset,
              currentTime: statePayload?.currentTime,
              lastUpdate: statePayload?.lastUpdate,
              progressActive: activeId ? progress[activeId] : undefined,
            })
          }

          setStateOverrides((prev) => ({
            ...prev,
            [room.id]: {
              activeTimerId: statePayload?.activeTimerId ?? room.state.activeTimerId ?? null,
              isRunning: statePayload?.isRunning ?? room.state.isRunning ?? false,
              startedAt: toMillis(statePayload?.startedAt, room.state.startedAt) ?? room.state.startedAt ?? null,
              elapsedOffset: statePayload?.elapsedOffset ?? room.state.elapsedOffset ?? 0,
              progress: statePayload?.progress ?? room.state.progress ?? {},
              showClock: statePayload?.showClock ?? room.state.showClock ?? false,
              clockMode: statePayload?.clockMode ?? room.state.clockMode ?? '24h',
              message: {
                text: statePayload?.message?.text ?? room.state.message.text ?? '',
                visible: statePayload?.message?.visible ?? room.state.message.visible ?? false,
                color: statePayload?.message?.color ?? room.state.message.color ?? 'green',
              },
              currentTime:
                typeof statePayload?.currentTime === 'number' ? statePayload.currentTime : room.state.currentTime,
              lastUpdate:
                typeof statePayload?.lastUpdate === 'number' ? statePayload.lastUpdate : room.state.lastUpdate,
              activeLiveCueId:
                typeof statePayload?.activeLiveCueId === 'string'
                  ? statePayload.activeLiveCueId
                  : room.state.activeLiveCueId,
            },
          }))
          // Clear any optimistic nudge accumulator once Firestore has acknowledged a state update.
          pendingNudgeRef.current[room.id] = 0
          setConnectionStatusFromSnapshot(docSnap.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('room state snapshot error', error)
        },
      )

      const timersUnsub = onSnapshot(
        timersQuery,
        { includeMetadataChanges: true },
        (snapshot) => {
          const timersForRoom: Timer[] = []
          snapshot.forEach((docSnap) => {
            timersForRoom.push(mapTimer(docSnap.id, room.id, docSnap.data() as TimerDoc))
          })
          setTimers((prev) => ({
            ...prev,
            [room.id]: timersForRoom.sort((a, b) => a.order - b.order),
          }))
          setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('timers snapshot error', error)
          setConnectionStatus('offline')
        },
      )

      const liveCuesRef = collection(firestore, 'rooms', room.id, 'liveCues')
      const liveCuesUnsub = onSnapshot(
        liveCuesRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          const records: LiveCueRecord[] = []
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() as LiveCueDoc
            const cue = mapLiveCue(docSnap.id, data)
            const updatedAt = typeof data.updatedAt === 'number'
              ? data.updatedAt
              : (typeof cue.startedAt === 'number' ? cue.startedAt : 0)
            const source = data.writeSource === 'companion' ? 'companion' : 'controller'
            records.push({ cue, updatedAt, source })
          })
          setLiveCueRecords((prev) => ({
            ...prev,
            [room.id]: records,
          }))
          setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('live cues snapshot error', error)
          if (error.code === 'permission-denied') {
            return
          }
          setConnectionStatus('offline')
        },
      )

      const cuesRef = collection(firestore, 'rooms', room.id, 'cues')
      const cuesUnsub = onSnapshot(
        cuesRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          const cuesForRoom: Cue[] = []
          snapshot.forEach((docSnap) => {
            cuesForRoom.push(mapCue(docSnap.id, room.id, docSnap.data() as CueDoc))
          })
          cuesForRoom.sort((a, b) => {
            const left = a.order ?? a.createdAt ?? 0
            const right = b.order ?? b.createdAt ?? 0
            return left - right
          })
          setCues((prev) => ({ ...prev, [room.id]: cuesForRoom }))
          setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('cues snapshot error', error)
          if (error.code === 'permission-denied') {
            return
          }
          setConnectionStatus('offline')
        },
      )
      const sectionsRef = collection(firestore, 'rooms', room.id, 'sections')
      const sectionsUnsub = onSnapshot(
        sectionsRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          const sectionsForRoom: Section[] = []
          snapshot.forEach((docSnap) => {
            sectionsForRoom.push(mapSection(docSnap.id, room.id, docSnap.data() as SectionDoc))
          })
          sectionsForRoom.sort((a, b) => a.order - b.order)
          setSections((prev) => ({ ...prev, [room.id]: sectionsForRoom }))
          setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('sections snapshot error', error)
          if (error.code === 'permission-denied') return
          setConnectionStatus('offline')
        },
      )

      const segmentsRef = collection(firestore, 'rooms', room.id, 'segments')
      const segmentsUnsub = onSnapshot(
        segmentsRef,
        { includeMetadataChanges: true },
        (snapshot) => {
          const segmentsForRoom: Segment[] = []
          snapshot.forEach((docSnap) => {
            segmentsForRoom.push(mapSegment(docSnap.id, room.id, docSnap.data() as SegmentDoc))
          })
          segmentsForRoom.sort((a, b) => a.order - b.order)
          setSegments((prev) => ({ ...prev, [room.id]: segmentsForRoom }))
          setConnectionStatusFromSnapshot(snapshot.metadata?.fromCache)
        },
        (error: FirestoreError) => {
          console.error('segments snapshot error', error)
          if (error.code === 'permission-denied') return
          setConnectionStatus('offline')
        },
      )

      return () => {
        stateUnsub()
        timersUnsub()
        liveCuesUnsub()
        cuesUnsub()
        sectionsUnsub()
        segmentsUnsub()
      }
    })
    return () => {
      unsubs.forEach((unsub) => unsub && unsub())
    }
  }, [fallbackToMock, firestore, rooms, setConnectionStatusFromSnapshot, subscriptionEpoch, user])

  const visibleRooms = useMemo(
    () =>
      rooms
        .filter((room) => !pendingRooms.has(room.id))
        .map((room) =>
          stateOverrides[room.id]
            ? {
                ...room,
                state: {
                  ...room.state,
                  ...stateOverrides[room.id],
                },
              }
            : room,
        )
        .sort((a, b) => roomOrderKey(a) - roomOrderKey(b)),
    [pendingRooms, rooms, stateOverrides],
  )

  const getRoom = useCallback(
    (roomId: string) => visibleRooms.find((room) => room.id === roomId),
    [visibleRooms],
  )
  const getTimers = useCallback(
    (roomId: string) => {
      const pendingForRoom = pendingTimers[roomId]
      return [...(timers[roomId] ?? [])]
        .filter((timer) => !pendingForRoom?.has(timer.id))
        .sort((a, b) => a.order - b.order)
    },
    [pendingTimers, timers],
  )

  const getCues = useCallback(
    (roomId: string) => [...(cues[roomId] ?? [])],
    [cues],
  )

  const getSections = useCallback(
    (roomId: string) => [...(sections[roomId] ?? [])],
    [sections],
  )

  const getSegments = useCallback(
    (roomId: string) => [...(segments[roomId] ?? [])],
    [segments],
  )

  const getLiveCueRecords = useCallback(
    (roomId: string) => [...(liveCueRecords[roomId] ?? [])],
    [liveCueRecords],
  )

  const getLiveCues = useCallback(
    (roomId: string) => getLiveCueRecords(roomId).map((record) => record.cue),
    [getLiveCueRecords],
  )

  // Ensure a room with timers always has an active timer id
  useEffect(() => {
    if (!firestore) return
    visibleRooms.forEach((room) => {
      const roomTimers = getTimers(room.id)
      if (roomTimers.length === 0) return
      if (!room.state.activeTimerId) {
        const stateRef =
          room._version === 2 ? firestoreDoc(firestore, 'rooms', room.id, 'state', 'current') : firestoreDoc(firestore, 'rooms', room.id)
        const payload =
          room._version === 2
            ? { activeTimerId: roomTimers[0].id, elapsedOffset: 0, [`progress.${roomTimers[0].id}`]: 0 }
            : { 'state.activeTimerId': roomTimers[0].id, 'state.elapsedOffset': 0, [`state.progress.${roomTimers[0].id}`]: 0 }
        void updateDocFs(stateRef, payload as Record<string, unknown>).catch((error) => {
          console.error('failed to set default active timer', error)
        })
      }
    })
  }, [firestore, getTimers, visibleRooms])

  const createRoom: DataContextValue['createRoom'] = useCallback(async ({ title, timezone, ownerId }) => {
    if (!firestore) throw new Error('firebase_unavailable')
    const ownerRooms = rooms.filter((candidate) => candidate.ownerId === ownerId && !pendingRooms.has(candidate.id))
    const nextOrder =
      ownerRooms.reduce((max, room) => Math.max(max, roomOrderKey(room)), 0) + 10
    const roomRef = doc(collection(firestore, 'rooms'))
    const defaultTimerRef = doc(collection(roomRef, 'timers'))
    const defaultTimer: Timer = {
      id: defaultTimerRef.id,
      roomId: roomRef.id,
      title: 'Opening Remarks',
      duration: 300,
      speaker: 'Host',
      type: 'countdown',
      order: 10,
    }

    const room: Room = {
      id: roomRef.id,
      ownerId,
      title,
      timezone,
      createdAt: Date.now(),
      order: nextOrder,
      config: DEFAULT_CONFIG,
      _version: 2,
      tier: 'basic',
      features: DEFAULT_FEATURES,
      state: {
        activeTimerId: defaultTimer.id,
        isRunning: false,
        startedAt: null,
        elapsedOffset: 0,
        progress: { [defaultTimer.id]: 0 },
        showClock: false,
        clockMode: '24h',
        message: { text: '', visible: false, color: 'green' },
      },
    }

    // Write the room first so Firestore rules can validate timer writes against an existing ownerId
    const roomPayload = {
      ...room,
      createdAt: serverTimestamp(),
      state: {
        ...room.state,
        clockMode: '24h',
      },
    }

    await setDoc(roomRef, roomPayload)
    // Seed v2 state doc
    await setDoc(firestoreDoc(firestore, 'rooms', roomRef.id, 'state', 'current'), {
      activeTimerId: defaultTimer.id,
      isRunning: false,
      currentTime: 0,
      lastUpdate: Date.now(),
    })
    await setDoc(defaultTimerRef, defaultTimer)

    return room
  }, [firestore, pendingRooms, rooms])

  const deleteRoom: DataContextValue['deleteRoom'] = useCallback(
    async (roomId) => {
      if (!user || !firestore) return
      const room = rooms.find((candidate) => candidate.id === roomId)
      const timersForRoom = [...(timers[roomId] ?? [])].sort((a, b) => a.order - b.order)
      if (!room) return

      const batch = writeBatch(firestore)
      timersForRoom.forEach((timer) => {
        batch.delete(doc(firestore, 'rooms', roomId, 'timers', timer.id))
      })
      batch.delete(doc(firestore, 'rooms', roomId))
      await batch.commit()

      // Write tombstone to prevent resurrection from companion/local cache
      const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
      const now = Date.now()
      await setDoc(doc(firestore, 'deleted_rooms', roomId), {
        roomId,
        deletedAt: Timestamp.fromMillis(now),
        expiresAt: Timestamp.fromMillis(now + TOMBSTONE_TTL_MS),
        deletedBy: user.uid,
      })
    },
    [firestore, rooms, timers, user],
  )

  const createTimer: DataContextValue['createTimer'] = useCallback(async (roomId, input) => {
    if (!firestore) throw new Error('firebase_unavailable')
    if (migratingRoomsRef.current.has(roomId)) throw new Error('room_migrating')
    const timerRef = doc(collection(firestore, 'rooms', roomId, 'timers'))
    const timer: Timer = {
      id: timerRef.id,
      roomId,
      title: input.title,
      duration: input.duration,
      speaker: input.speaker ?? '',
      type: 'countdown',
      order: Date.now(),
      updatedAt: Date.now(),
    }
    await setDoc(timerRef, timer)
    const room = getRoom(roomId)
    if ((room?._version ?? 1) === 2) {
      const stateRef = firestoreDoc(firestore, 'rooms', roomId, 'state', 'current')
      const nextProgress = { ...(room?.state.progress ?? {}), [timer.id]: 0 }
      await setDoc(
        stateRef,
        {
          activeTimerId: room?.state.activeTimerId ?? timer.id,
          progress: nextProgress,
        },
        { merge: true },
      )
    } else {
      await updateDoc(doc(firestore, 'rooms', roomId), {
        [`state.progress.${timer.id}`]: 0,
        'state.activeTimerId': room?.state.activeTimerId ?? timer.id,
      })
    }
    return timer
  }, [firestore, getRoom])

  const createCue: DataContextValue['createCue'] = useCallback(async (roomId, input) => {
    if (!firestore) throw new Error('firebase_unavailable')
    if (!user?.uid) throw new Error('auth_required')
    const cueRef = doc(collection(firestore, 'rooms', roomId, 'cues'))
    const existing = cues[roomId] ?? []
    const nextOrder =
      typeof input.order === 'number' && Number.isFinite(input.order)
        ? input.order
        : existing.length
          ? Math.max(...existing.map((cue) => cue.order ?? 0)) + 10
          : 10
    const now = Date.now()
    const cue: Cue = {
      id: cueRef.id,
      roomId,
      title: input.title.trim(),
      role: input.role,
      triggerType: input.triggerType,
      notes: input.notes,
      sectionId: input.sectionId,
      segmentId: input.segmentId,
      order: nextOrder,
      offsetMs: input.offsetMs,
      timeBase: input.timeBase,
      targetTimeMs: input.targetTimeMs,
      afterCueId: input.afterCueId,
      approximatePosition: input.approximatePosition,
      triggerNote: input.triggerNote,
      createdBy: user.uid,
      createdByRole: input.createdByRole,
      createdAt: now,
      updatedAt: now,
    }
    await setDoc(cueRef, cue)
    return cue
  }, [cues, firestore, user?.uid])

  const updateTimer: DataContextValue['updateTimer'] = useCallback(
    async (roomId, timerId, patch) => {
      if (migratingRoomsRef.current.has(roomId) || !firestore) return
      const room = getRoom(roomId)
      try {
        await updateDoc(doc(firestore, 'rooms', roomId, 'timers', timerId), { ...patch, updatedAt: Date.now() })
        if (patch.duration !== undefined && room) {
          const stateUpdates: Record<string, unknown> =
            (room._version ?? 1) === 2
              ? {
                  [`progress.${timerId}`]: 0,
                }
              : {
                  [`state.progress.${timerId}`]: 0,
                }
          if (room.state.activeTimerId === timerId) {
            if ((room._version ?? 1) === 2) {
              stateUpdates['elapsedOffset'] = 0
              stateUpdates['startedAt'] = room.state.isRunning ? Date.now() : null
            } else {
              stateUpdates['state.elapsedOffset'] = 0
              stateUpdates['state.startedAt'] = room.state.isRunning ? Date.now() : null
            }
          }
          const stateRef =
            (room._version ?? 1) === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
          await updateDocFs(stateRef, stateUpdates)
        }
      } catch (error) {
        console.warn('Failed to update timer', error)
      }
    },
    [firestore, getRoom],
  )

  const updateCue: DataContextValue['updateCue'] = useCallback(
    async (roomId, cueId, patch) => {
      if (!firestore) return
      const now = Date.now()
      const payload: Record<string, unknown> = {
        ...patch,
        updatedAt: now,
      }
      if (user?.uid) {
        payload.editedBy = user.uid
      }
      await updateDoc(doc(firestore, 'rooms', roomId, 'cues', cueId), payload)
    },
    [firestore, user?.uid],
  )

  const updateRoomMeta: DataContextValue['updateRoomMeta'] = useCallback(
    async (roomId, patch) => {
      if (migratingRoomsRef.current.has(roomId) || !firestore) return
      await updateDoc(doc(firestore, 'rooms', roomId), patch)
    },
    [firestore],
  )

  const updateRoomTier: DataContextValue['updateRoomTier'] = useCallback(
    async (roomId, tier) => {
      if (migratingRoomsRef.current.has(roomId) || !firestore) return
      await updateDoc(doc(firestore, 'rooms', roomId), {
        tier,
        updatedAt: Date.now(),
      })
    },
    [firestore],
  )

  const restoreTimer: DataContextValue['restoreTimer'] = useCallback(async (roomId, timer) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    await setDoc(doc(firestore, 'rooms', roomId, 'timers', timer.id), timer)
    const room = getRoom(roomId)
    if ((room?._version ?? 1) === 2) {
      await updateDocFs(firestoreDoc(firestore, 'rooms', roomId, 'state', 'current'), {
        [`progress.${timer.id}`]: 0,
      })
      return
    }
    await updateDoc(doc(firestore, 'rooms', roomId), { [`state.progress.${timer.id}`]: 0 })
  }, [firestore, getRoom])

  const resetTimerProgress: DataContextValue['resetTimerProgress'] = useCallback(async (roomId, timerId) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    const isActive = room?.state.activeTimerId === timerId
    const updates: Record<string, unknown> = {
      ...((room?._version ?? 1) === 2 ? { [`progress.${timerId}`]: 0 } : { [`state.progress.${timerId}`]: 0 }),
    }
    if (isActive) {
      if ((room?._version ?? 1) === 2) {
        updates['elapsedOffset'] = 0
        updates['startedAt'] = null
        updates['isRunning'] = false
      } else {
        updates['state.elapsedOffset'] = 0
        updates['state.startedAt'] = null
        updates['state.isRunning'] = false
      }
    }
    const stateRef =
      (room?._version ?? 1) === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
    await updateDocFs(stateRef, updates)
  }, [firestore, getRoom])

  const deleteTimer: DataContextValue['deleteTimer'] = useCallback(
    async (roomId, timerId) => {
      if (!user || migratingRoomsRef.current.has(roomId) || !firestore) return
      await deleteDoc(doc(firestore, 'rooms', roomId, 'timers', timerId))
      const room = getRoom(roomId)
      const stateRef =
        (room?._version ?? 1) === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
      const key = (room?._version ?? 1) === 2 ? `progress.${timerId}` : `state.progress.${timerId}`
      await updateDocFs(stateRef, { [key]: 0 })
    },
    [firestore, getRoom, user],
  )

  const deleteCue: DataContextValue['deleteCue'] = useCallback(
    async (roomId, cueId) => {
      if (!user || !firestore) return
      await deleteDoc(doc(firestore, 'rooms', roomId, 'cues', cueId))
    },
    [firestore, user],
  )

  const reorderCues: DataContextValue['reorderCues'] = useCallback(
    async (roomId, cueIds) => {
      if (!user || !firestore) return
      const batch = writeBatch(firestore)
      const now = Date.now()
      cueIds.forEach((cueId, idx) => {
        batch.update(doc(firestore, 'rooms', roomId, 'cues', cueId), {
          order: (idx + 1) * 10,
          updatedAt: now,
        })
      })
      await batch.commit()
    },
    [firestore, user],
  )

  const createSection: DataContextValue['createSection'] = useCallback(async (roomId, input) => {
    if (!firestore || !user?.uid) throw new Error('firebase_unavailable')
    const sectionRef = doc(collection(firestore, 'rooms', roomId, 'sections'))
    const existing = sections[roomId] ?? []
    const nextOrder =
      typeof input.order === 'number' && Number.isFinite(input.order)
        ? input.order
        : existing.length
          ? Math.max(...existing.map((s) => s.order)) + 10
          : 10
    const now = Date.now()
    const section: Section = {
      id: sectionRef.id,
      roomId,
      title: input.title.trim(),
      order: nextOrder,
      notes: input.notes,
      plannedDurationSec: input.plannedDurationSec,
      plannedStartAt: input.plannedStartAt,
      createdAt: now,
      updatedAt: now,
    }
    await setDoc(sectionRef, stripUndefined(section))
    return section
  }, [firestore, sections, user?.uid])

  const updateSection: DataContextValue['updateSection'] = useCallback(
    async (roomId, sectionId, patch) => {
      if (!firestore) return
      const payload = stripUndefined({ ...patch, updatedAt: Date.now() })
      if (Object.keys(payload).length === 0) return
      await updateDoc(doc(firestore, 'rooms', roomId, 'sections', sectionId), payload)
    },
    [firestore],
  )

  const deleteSection: DataContextValue['deleteSection'] = useCallback(
    async (roomId, sectionId) => {
      if (!user || !firestore) return
      await deleteDoc(doc(firestore, 'rooms', roomId, 'sections', sectionId))
    },
    [firestore, user],
  )

  const reorderSections: DataContextValue['reorderSections'] = useCallback(
    async (roomId, sectionIds) => {
      if (!user || !firestore) return
      const batch = writeBatch(firestore)
      const now = Date.now()
      sectionIds.forEach((sectionId, idx) => {
        batch.update(doc(firestore, 'rooms', roomId, 'sections', sectionId), {
          order: (idx + 1) * 10,
          updatedAt: now,
        })
      })
      await batch.commit()
    },
    [firestore, user],
  )

  const createSegment: DataContextValue['createSegment'] = useCallback(async (roomId, input) => {
    if (!firestore || !user?.uid) throw new Error('firebase_unavailable')
    const segmentRef = doc(collection(firestore, 'rooms', roomId, 'segments'))
    const existing = segments[roomId] ?? []
    const sameSection = existing.filter((s) => s.sectionId === input.sectionId)
    const nextOrder =
      typeof input.order === 'number' && Number.isFinite(input.order)
        ? input.order
        : sameSection.length
          ? Math.max(...sameSection.map((s) => s.order)) + 10
          : 10
    const now = Date.now()
    const segment: Segment = {
      id: segmentRef.id,
      roomId,
      sectionId: input.sectionId,
      title: input.title.trim(),
      order: nextOrder,
      plannedStartAt: input.plannedStartAt,
      plannedDurationSec: input.plannedDurationSec,
      primaryTimerId: input.primaryTimerId,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    }
    await setDoc(segmentRef, stripUndefined(segment))
    return segment
  }, [firestore, segments, user?.uid])

  const updateSegment: DataContextValue['updateSegment'] = useCallback(
    async (roomId, segmentId, patch) => {
      if (!firestore) return
      const payload = stripUndefined({ ...patch, updatedAt: Date.now() })
      if (Object.keys(payload).length === 0) return
      await updateDoc(doc(firestore, 'rooms', roomId, 'segments', segmentId), payload)
    },
    [firestore],
  )

  const deleteSegment: DataContextValue['deleteSegment'] = useCallback(
    async (roomId, segmentId) => {
      if (!user || !firestore) return
      await deleteDoc(doc(firestore, 'rooms', roomId, 'segments', segmentId))
    },
    [firestore, user],
  )

  const reorderSegments: DataContextValue['reorderSegments'] = useCallback(
    async (roomId, _sectionId, segmentIds) => {
      // sectionId is API-level scoping; callers must pass only segment IDs from that section.
      void _sectionId
      if (!user || !firestore) return
      const batch = writeBatch(firestore)
      const now = Date.now()
      segmentIds.forEach((segmentId, idx) => {
        batch.update(doc(firestore, 'rooms', roomId, 'segments', segmentId), {
          order: (idx + 1) * 10,
          updatedAt: now,
        })
      })
      await batch.commit()
    },
    [firestore, user],
  )

  // Undo/Redo Stubs
  const undoRoomDelete: DataContextValue['undoRoomDelete'] = useCallback(async () => {
    console.warn('Undo Room Delete not implemented yet (Command Pattern pending)')
  }, [])

  const redoRoomDelete: DataContextValue['redoRoomDelete'] = useCallback(async () => {
    console.warn('Redo Room Delete not implemented yet (Command Pattern pending)')
  }, [])

  const undoTimerDelete: DataContextValue['undoTimerDelete'] = useCallback(async () => {
    console.warn('Undo Timer Delete not implemented yet (Command Pattern pending)')
  }, [])

  const redoTimerDelete: DataContextValue['redoTimerDelete'] = useCallback(async () => {
    console.warn('Redo Timer Delete not implemented yet (Command Pattern pending)')
  }, [])

  const clearUndoStacks: DataContextValue['clearUndoStacks'] = useCallback(async () => {
    console.warn('Clear Undo Stacks not implemented yet (Command Pattern pending)')
  }, [])

  const undoLatest: DataContextValue['undoLatest'] = useCallback(async () => {
    console.warn('Undo Latest not implemented yet (Command Pattern pending)')
  }, [])

  const redoLatest: DataContextValue['redoLatest'] = useCallback(async () => {
    console.warn('Redo Latest not implemented yet (Command Pattern pending)')
  }, [])

  const moveRoom: DataContextValue['moveRoom'] = useCallback(
    async (roomId: string, direction: 'up' | 'down') => {
      if (!user || migratingRoomsRef.current.has(roomId) || !firestore) return
      const owned = rooms.filter(
        (room) => room.ownerId === user.uid && !pendingRooms.has(room.id),
      )
      const ordered = [...owned].sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
      const index = ordered.findIndex((room) => room.id === roomId)
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return
        ;[ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]]
      const batch = writeBatch(firestore)
      ordered.forEach((room, idx) => {
        batch.update(doc(firestore, 'rooms', room.id), { order: (idx + 1) * 10 })
      })
      await batch.commit()
    },
    [firestore, pendingRooms, rooms, user],
  )

  const reorderRoom: DataContextValue['reorderRoom'] = useCallback(
    async (roomId: string, targetIndex: number) => {
      if (!user || migratingRoomsRef.current.has(roomId) || !firestore) return
      const owned = rooms.filter(
        (room) => room.ownerId === user.uid && !pendingRooms.has(room.id),
      )
      const ordered = [...owned].sort((a, b) => roomOrderKey(a) - roomOrderKey(b))
      const fromIndex = ordered.findIndex((room) => room.id === roomId)
      if (fromIndex === -1) return
      const [moved] = ordered.splice(fromIndex, 1)
      const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
      ordered.splice(clampedIndex, 0, moved)
      const batch = writeBatch(firestore)
      ordered.forEach((room, idx) => {
        batch.update(doc(firestore, 'rooms', room.id), { order: (idx + 1) * 10 })
      })
      await batch.commit()
    },
    [firestore, pendingRooms, rooms, user],
  )

  const moveTimer: DataContextValue['moveTimer'] = useCallback(async (roomId, timerId, direction) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const list = getTimers(roomId)
    const ordered = [...list].sort((a, b) => a.order - b.order)
    const index = ordered.findIndex((t) => t.id === timerId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return
      ;[ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]]
    const batch = writeBatch(firestore)
    const now = Date.now()
    ordered.forEach((timer, idx) => {
      const newOrder = (idx + 1) * 10
      const updates: Record<string, unknown> = { order: newOrder }
      if (timer.order !== newOrder) {
        updates.updatedAt = now
      }
      batch.update(doc(firestore, 'rooms', roomId, 'timers', timer.id), updates)
    })
    await batch.commit()
  }, [firestore, getTimers])

  const reorderTimer: DataContextValue['reorderTimer'] = useCallback(async (roomId, timerId, targetIndex) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const ordered = [...getTimers(roomId)].sort((a, b) => a.order - b.order)
    const fromIndex = ordered.findIndex((t) => t.id === timerId)
    if (fromIndex === -1) return
    const [moved] = ordered.splice(fromIndex, 1)
    const clampedIndex = Math.max(0, Math.min(targetIndex, ordered.length))
    ordered.splice(clampedIndex, 0, moved)
    const batch = writeBatch(firestore)
    const now = Date.now()
    ordered.forEach((timer, idx) => {
      const newOrder = (idx + 1) * 10
      const updates: Record<string, unknown> = { order: newOrder }
      if (timer.order !== newOrder) {
        updates.updatedAt = now
      }
      batch.update(doc(firestore, 'rooms', roomId, 'timers', timer.id), updates)
    })
    await batch.commit()
  }, [firestore, getTimers])

  const setActiveTimer: DataContextValue['setActiveTimer'] = useCallback(async (roomId, timerId) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    const progress = room ? computeProgress(room) : {}
    const elapsedOffset = progress[timerId] ?? 0
    const now = Date.now()
    const stateRef =
      room?._version === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
    if (room?._version === 2) {
      await updateDocFs(stateRef, {
        activeTimerId: timerId,
        elapsedOffset,
        startedAt: null,
        isRunning: false,
        progress,
        currentTime: elapsedOffset,
        lastUpdate: now,
      })
      return
    }
    await updateDoc(doc(firestore, 'rooms', roomId), {
      'state.activeTimerId': timerId,
      'state.elapsedOffset': elapsedOffset,
      'state.startedAt': null,
      'state.isRunning': false,
      'state.progress': progress,
      'state.currentTime': elapsedOffset,
      'state.lastUpdate': now,
    })
  }, [firestore, getRoom])

  const startTimer: DataContextValue['startTimer'] = useCallback(async (roomId, timerId) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    const targetTimerId = timerId ?? room?.state.activeTimerId
    if (!targetTimerId || !room) return
    const progress = computeProgress(room)
    const elapsedOffset = progress[targetTimerId] ?? 0
    const now = Date.now()
    const stateRef =
      room._version === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
    await updateDocFs(stateRef, {
      activeTimerId: targetTimerId,
      isRunning: true,
      startedAt: now,
      elapsedOffset,
      progress,
      currentTime: elapsedOffset,
      lastUpdate: now,
    })
  }, [firestore, getRoom])

  const pauseTimer: DataContextValue['pauseTimer'] = useCallback(async (roomId) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    if (!room?.state.activeTimerId) return
    const activeId = room.state.activeTimerId
    const progress = computeProgress(room)
    const elapsed = progress[activeId] ?? 0
    const now = Date.now()
    const stateRef =
      room._version === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
    await updateDocFs(stateRef, {
      isRunning: false,
      startedAt: null,
      elapsedOffset: elapsed,
      progress,
      currentTime: elapsed,
      lastUpdate: now,
    })
  }, [firestore, getRoom])

  const resetTimer: DataContextValue['resetTimer'] = useCallback(async (roomId) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    const progress = room ? computeProgress(room) : {}
    if (activeId) {
      progress[activeId] = 0
    }
    const nextElapsedOffset = 0
    const now = Date.now()
    const stateRef =
      room?._version === 2 ? firestoreDoc(firestore, 'rooms', roomId, 'state', 'current') : firestoreDoc(firestore, 'rooms', roomId)
    await updateDocFs(stateRef, {
      isRunning: false,
      startedAt: null,
      elapsedOffset: nextElapsedOffset,
      progress,
      currentTime: nextElapsedOffset,
      lastUpdate: now,
    })

    // Restore duration to originalDuration if it was adjusted by nudge
    if (activeId) {
      const roomTimers = getTimers(roomId)
      const activeTimer = roomTimers.find((t) => t.id === activeId)
      if (activeTimer?.originalDuration !== undefined && activeTimer.duration !== activeTimer.originalDuration) {
        await updateDoc(doc(firestore, 'rooms', roomId, 'timers', activeId), {
          duration: activeTimer.originalDuration,
          originalDuration: deleteField(),
          updatedAt: Date.now(),
        })
      }
    }
  }, [firestore, getRoom, getTimers])

  const nudgeTimer: DataContextValue['nudgeTimer'] = useCallback(async (roomId, deltaMs) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const room = getRoom(roomId)
    const activeId = room?.state.activeTimerId
    if (!room || !activeId) return

    // Adjust duration instead of elapsed - uses reliable timer sync path
    const roomTimers = getTimers(roomId)
    const activeTimer = roomTimers.find((t) => t.id === activeId)
    if (activeTimer) {
      const deltaSec = Math.round(deltaMs / 1000)
      const newDuration = Math.max(0, activeTimer.duration + deltaSec)
      // Set originalDuration on first nudge so reset can restore it
    const updates: Record<string, unknown> = { duration: newDuration, updatedAt: Date.now() }
      if (activeTimer.originalDuration === undefined) {
        updates.originalDuration = activeTimer.duration
      }
      await updateDoc(doc(firestore, 'rooms', roomId, 'timers', activeId), updates)
    }
  }, [firestore, getRoom, getTimers])

  const setClockMode: DataContextValue['setClockMode'] = useCallback(async (roomId, enabled) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    await updateDoc(doc(firestore, 'rooms', roomId), {
      'state.showClock': enabled,
    })
  }, [firestore])

  const setClockFormat: DataContextValue['setClockFormat'] = useCallback(async (roomId, format) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    await updateDoc(doc(firestore, 'rooms', roomId), {
      'state.clockMode': format,
    })
  }, [firestore])

  const updateMessage: DataContextValue['updateMessage'] = useCallback(async (roomId, message) => {
    if (migratingRoomsRef.current.has(roomId) || !firestore) return
    const payload: Record<string, unknown> = {}
    if (message.text !== undefined) payload['state.message.text'] = message.text
    if (message.visible !== undefined) payload['state.message.visible'] = message.visible
    if (message.color !== undefined) payload['state.message.color'] = message.color
    await updateDoc(doc(firestore, 'rooms', roomId), payload)
  }, [firestore])

  const migrateRoomToV2 = useCallback(
    async (roomId: string) => {
      if (!user) throw new Error('unauthenticated')
      if (!firestore) throw new Error('firebase_unavailable')
      if (migratingRoomsRef.current.has(roomId)) return
      migratingRoomsRef.current.add(roomId)
      try {
        const roomRef = doc(firestore, 'rooms', roomId)
        const legacySnap = await getDoc(roomRef)
        if (!legacySnap.exists()) throw new Error('room_not_found')
        const legacyData = legacySnap.data() as DocumentData
        const legacyVersion = typeof legacyData._version === 'number' ? legacyData._version : 1
        if (legacyVersion === 2) return
        if (legacyData.ownerId !== user.uid) throw new Error('not_owner')

        const legacyState = (legacyData.state ?? {}) as Record<string, unknown>
        const activeTimerId = typeof legacyState.activeTimerId === 'string' ? legacyState.activeTimerId : null
        const isRunning = Boolean(legacyState.isRunning)
        const startedAt = typeof legacyState.startedAt === 'number' ? legacyState.startedAt : null
        const elapsedOffset = typeof legacyState.elapsedOffset === 'number' ? legacyState.elapsedOffset : 0
        const progress = (legacyState.progress ?? {}) as Record<string, unknown>
        const baseElapsed =
          activeTimerId && typeof progress[activeTimerId] === 'number' ? (progress[activeTimerId] as number) : 0
        const elapsedMs =
          activeTimerId && isRunning && startedAt ? Date.now() - startedAt + baseElapsed : baseElapsed || elapsedOffset
        const currentTime = Math.max(0, Math.round(elapsedMs / 1000))

        const now = Date.now()
        const backupId = String(now)
        const backupRef = doc(firestore, 'rooms', roomId, 'migrationBackups', backupId)
        const stateRef = firestoreDoc(firestore, 'rooms', roomId, 'state', 'current')

        const batch = writeBatch(firestore)
        batch.set(backupRef, {
          createdAtMs: now,
          expiresAtMs: now + MIGRATION_RETENTION_MS,
          legacyRoom: legacyData,
        })
        batch.set(stateRef, { activeTimerId, isRunning, currentTime, lastUpdate: now }, { merge: true })
        batch.set(
          roomRef,
          {
            tier: 'basic',
            features: DEFAULT_FEATURES,
            _version: 2,
          },
          { merge: true },
        )
        await batch.commit()
        console.info(`[firebase] migrated room ${roomId} to v2 (backup=${backupId})`)
      } finally {
        migratingRoomsRef.current.delete(roomId)
      }
    },
    [firestore, user],
  )

  const rollbackRoomMigration = useCallback(
    async (roomId: string) => {
      if (!user) throw new Error('unauthenticated')
      if (!firestore) throw new Error('firebase_unavailable')
      if (migratingRoomsRef.current.has(roomId)) return
      migratingRoomsRef.current.add(roomId)
      try {
        const roomRef = doc(firestore, 'rooms', roomId)
        const roomSnap = await getDoc(roomRef)
        if (!roomSnap.exists()) throw new Error('room_not_found')
        const current = roomSnap.data() as DocumentData
        if (current.ownerId !== user.uid) throw new Error('not_owner')

        const backupsQuery = query(
          collection(firestore, 'rooms', roomId, 'migrationBackups'),
          orderBy('createdAtMs', 'desc'),
          limit(1),
        )
        const backupsSnap = await getDocs(backupsQuery)
        const latest = backupsSnap.docs[0]
        if (!latest) throw new Error('backup_missing')
        const backup = latest.data() as DocumentData
        const expiresAtMs = typeof backup.expiresAtMs === 'number' ? backup.expiresAtMs : 0
        if (!expiresAtMs || Date.now() > expiresAtMs) {
          throw new Error('backup_expired')
        }
        const legacyRoom = backup.legacyRoom as DocumentData | undefined
        if (!legacyRoom || typeof legacyRoom !== 'object') throw new Error('backup_invalid')

        const stateRef = firestoreDoc(firestore, 'rooms', roomId, 'state', 'current')
        const batch = writeBatch(firestore)
        batch.set(roomRef, legacyRoom)
        batch.delete(stateRef)
        await batch.commit()
        console.info(`[firebase] rolled back room ${roomId} to legacy (backup=${latest.id})`)
      } finally {
        migratingRoomsRef.current.delete(roomId)
      }
    },
    [firestore, user],
  )

  const controllerLocks = useMemo<Record<string, null>>(() => ({}), [])
  const roomPins = useMemo<Record<string, RoomPinMeta | null>>(() => ({}), [])
  const roomClients = useMemo<Record<string, ControllerClient[]>>(() => ({}), [])
  const controlRequests = useMemo<Record<string, null>>(() => ({}), [])
  const pendingControlRequests = useMemo<Record<string, null>>(() => ({}), [])
  const controlDenials = useMemo<Record<string, null>>(() => ({}), [])
  const controlDisplacements = useMemo<Record<string, null>>(() => ({}), [])
  const controlErrors = useMemo<Record<string, null>>(() => ({}), [])
  const getControllerLock = useCallback(() => null, [])
  const getControllerLockState = useCallback(() => 'authoritative', [])
  const getRoomPin = useCallback(() => null, [])
  const setRoomPin = useCallback(() => {}, [])
  const requestControl = useCallback(() => {}, [])
  const forceTakeover = useCallback((_roomId: string, _options?: { pin?: string; reauthenticated?: boolean }) => {
    void _roomId
    void _options
  }, [])
  const handOverControl = useCallback(() => {}, [])
  const denyControl = useCallback(() => {}, [])
  const sendHeartbeat = useCallback(() => {}, [])

  const value = useMemo<DataContextValue>(
    () => ({
      rooms: visibleRooms,
      connectionStatus,
      setConnectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      undoRoomDelete,
      redoRoomDelete,
      undoTimerDelete,
      redoTimerDelete,
      undoLatest,
      redoLatest,
      clearUndoStacks,
      getRoom,
      getTimers,
      getCues,
      getSections,
      getSegments,
      getLiveCues,
      getLiveCueRecords,
      createRoom,
      deleteRoom,
      createTimer,
      createCue,
      updateTimer,
      updateCue,
      updateRoomMeta,
      updateRoomTier,
      moveRoom,
      reorderRoom,
      restoreTimer,
      resetTimerProgress,
      deleteTimer,
      deleteCue,
      moveTimer,
      reorderTimer,
      reorderCues,
      createSection,
      updateSection,
      deleteSection,
      reorderSections,
      createSegment,
      updateSegment,
      deleteSegment,
      reorderSegments,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
      setClockFormat,
      updateMessage,
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
      migrateRoomToV2,
      rollbackRoomMigration,
    }),
    [
      visibleRooms,
      connectionStatus,
      pendingRooms,
      pendingRoomPlaceholders,
      pendingTimers,
      pendingTimerPlaceholders,
      undoRoomDelete,
      redoRoomDelete,
      undoTimerDelete,
      redoTimerDelete,
      undoLatest,
      redoLatest,
      clearUndoStacks,
      getRoom,
      getTimers,
      getCues,
      getSections,
      getSegments,
      getLiveCues,
      getLiveCueRecords,
      createRoom,
      deleteRoom,
      createTimer,
      createCue,
      updateTimer,
      updateCue,
      updateRoomMeta,
      updateRoomTier,
      moveRoom,
      reorderRoom,
      restoreTimer,
      resetTimerProgress,
      deleteTimer,
      deleteCue,
      moveTimer,
      reorderTimer,
      reorderCues,
      createSection,
      updateSection,
      deleteSection,
      reorderSections,
      createSegment,
      updateSegment,
      deleteSegment,
      reorderSegments,
      setActiveTimer,
      startTimer,
      pauseTimer,
      resetTimer,
      nudgeTimer,
      setClockMode,
      setClockFormat,
      updateMessage,
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
      migrateRoomToV2,
      rollbackRoomMigration,
    ],
  )

  if (fallbackToMock) {
    return <MockDataProvider>{children}</MockDataProvider>
  }

  return <DataProviderBoundary value={value}>{children}</DataProviderBoundary>
}
