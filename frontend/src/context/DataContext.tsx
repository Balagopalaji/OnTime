/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type {
  ConnectionStatus,
  Room,
  Timer,
  LiveCue,
  LiveCueRecord,
  Cue,
  Section,
  Segment,
  CueTriggerType,
  OperatorRole,
  MessageColor,
  ControllerLock,
  ControllerLockState,
  ControllerClient,
} from '../types'

type CreateRoomInput = {
  title: string
  timezone: string
  ownerId: string
}

type CreateTimerInput = {
  title: string
  duration: number
  speaker?: string
}

type CreateCueInput = {
  title: string
  role: OperatorRole
  triggerType: CueTriggerType
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
  createdByRole?: OperatorRole
}

type CreateSectionInput = {
  title: string
  notes?: string
  plannedDurationSec?: number
  plannedStartAt?: number
  order?: number
}

type CreateSegmentInput = {
  title: string
  sectionId?: string
  plannedStartAt?: number
  plannedDurationSec?: number
  primaryTimerId?: string
  notes?: string
  order?: number
}

type QueueStatus = {
  count: number
  max: number
  percent: number
  nearLimit: boolean
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

type ControlDisplacement = {
  takenAt: number
  takenById: string
  takenByName?: string
  takenByUserId?: string
  takenByUserName?: string
}

type ControlError = {
  code: string
  message: string
  receivedAt: number
}

export type RoomPinMeta = { value: string | null; updatedAt: number; source: 'cloud' | 'companion' }

export type DataContextValue = {
  rooms: Room[]
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void
  pendingRooms: Set<string>
  pendingRoomPlaceholders: Array<{
    roomId: string
    title: string
    expiresAt: number
    createdAt: number
    order?: number
  }>
  pendingTimers: Record<string, Set<string>>
  pendingTimerPlaceholders: Record<
    string,
    Array<{ timerId: string; title: string; order: number; expiresAt: number }>
  >
  queueStatus?: Record<string, QueueStatus>
  undoRoomDelete: () => Promise<void>
  redoRoomDelete: () => Promise<void>
  undoTimerDelete: (roomId: string) => Promise<void>
  redoTimerDelete: (roomId: string) => Promise<void>
  undoLatest?: (roomId: string) => Promise<void>
  redoLatest?: (roomId: string) => Promise<void>
  clearUndoStacks: () => Promise<void>
  getRoom: (roomId: string) => Room | undefined
  getTimers: (roomId: string) => Timer[]
  getCues: (roomId: string) => Cue[]
  getLiveCues: (roomId: string) => LiveCue[]
  getLiveCueRecords: (roomId: string) => LiveCueRecord[]
  getLiveCueDiagnostics?: (roomId: string) => {
    canUseLiveCues: boolean
    isCompanionLive: boolean
    isSubscribed: boolean
    firebaseCount: number
    companionCount: number
  }
  createRoom: (input: CreateRoomInput) => Promise<Room>
  deleteRoom: (roomId: string) => Promise<void>
  createTimer: (roomId: string, input: CreateTimerInput) => Promise<Timer | undefined>
  createCue: (roomId: string, input: CreateCueInput) => Promise<Cue | undefined>
  updateTimer: (
    roomId: string,
    timerId: string,
    patch: Partial<Omit<Timer, 'id' | 'roomId'>>,
  ) => Promise<void>
  updateCue: (
    roomId: string,
    cueId: string,
    patch: Partial<Omit<Cue, 'id' | 'roomId' | 'createdBy' | 'createdAt'>>,
  ) => Promise<void>
  updateRoomMeta: (
    roomId: string,
    patch: Partial<Pick<Room, 'title' | 'timezone'>>,
  ) => Promise<void>
  updateRoomTier?: (roomId: string, tier: Room['tier']) => Promise<void>
  moveRoom?: (roomId: string, direction: 'up' | 'down') => Promise<void>
  reorderRoom?: (roomId: string, targetIndex: number) => Promise<void>
  restoreTimer: (roomId: string, timer: Timer) => Promise<void>
  resetTimerProgress: (roomId: string, timerId: string) => Promise<void>
  deleteTimer: (roomId: string, timerId: string) => Promise<void>
  deleteCue: (roomId: string, cueId: string) => Promise<void>
  moveTimer: (
    roomId: string,
    timerId: string,
    direction: 'up' | 'down',
  ) => Promise<void>
  reorderTimer: (roomId: string, timerId: string, targetIndex: number) => Promise<void>
  reorderCues: (roomId: string, cueIds: string[]) => Promise<void>
  getSections: (roomId: string) => Section[]
  getSegments: (roomId: string) => Segment[]
  createSection: (roomId: string, input: CreateSectionInput) => Promise<Section | undefined>
  updateSection: (
    roomId: string,
    sectionId: string,
    patch: Partial<Omit<Section, 'id' | 'roomId'>>,
  ) => Promise<void>
  deleteSection: (roomId: string, sectionId: string) => Promise<void>
  reorderSections: (roomId: string, sectionIds: string[]) => Promise<void>
  createSegment: (roomId: string, input: CreateSegmentInput) => Promise<Segment | undefined>
  updateSegment: (
    roomId: string,
    segmentId: string,
    patch: Partial<Omit<Segment, 'id' | 'roomId'>>,
  ) => Promise<void>
  deleteSegment: (roomId: string, segmentId: string) => Promise<void>
  reorderSegments: (roomId: string, sectionId: string, segmentIds: string[]) => Promise<void>
  setActiveTimer: (roomId: string, timerId: string) => Promise<void>
  startTimer: (roomId: string, timerId?: string) => Promise<void>
  pauseTimer: (roomId: string) => Promise<void>
  resetTimer: (roomId: string) => Promise<void>
  nudgeTimer: (roomId: string, deltaMs: number) => Promise<void>
  setClockMode: (roomId: string, enabled: boolean) => Promise<void>
  setClockFormat: (roomId: string, format: '24h' | 'ampm') => Promise<void>
  updateMessage: (
    roomId: string,
    message: Partial<{ text: string; color: MessageColor; visible: boolean }>,
  ) => Promise<void>
  controllerLocks: Record<string, ControllerLock | null>
  roomPins: Record<string, RoomPinMeta | null>
  roomClients: Record<string, ControllerClient[]>
  controlRequests: Record<string, ControlRequest | null>
  pendingControlRequests: Record<string, ControlRequest | null>
  controlDenials: Record<string, ControlDenial | null>
  controlDisplacements: Record<string, ControlDisplacement | null>
  controlErrors: Record<string, ControlError | null>
  getControllerLock: (roomId: string) => ControllerLock | null
  getControllerLockState: (roomId: string) => ControllerLockState
  getRoomPin: (roomId: string) => RoomPinMeta | null
  setRoomPin: (roomId: string, pin: string | null) => void
  requestControl: (roomId: string, deviceName?: string) => void
  forceTakeover: (roomId: string, options?: { pin?: string; reauthenticated?: boolean }) => void
  handOverControl: (roomId: string, targetClientId: string) => void
  denyControl: (roomId: string, requesterId: string) => void
  sendHeartbeat: (roomId: string) => void
  migrateRoomToV2?: (roomId: string) => Promise<void>
  rollbackRoomMigration?: (roomId: string) => Promise<void>
}

export const DataContext = createContext<DataContextValue | undefined>(undefined)

export const useDataContext = () => {
  const ctx = useContext(DataContext)
  if (!ctx) {
    throw new Error('useDataContext must be used within a DataProvider')
  }
  return ctx
}

export const DataProviderBoundary = ({
  value,
  children,
}: {
  value: DataContextValue
  children: ReactNode
}) => <DataContext.Provider value={value}>{children}</DataContext.Provider>
