export type MessageColor = 'green' | 'yellow' | 'red' | 'blue' | 'white' | 'none'

export type TimerType = 'countdown' | 'countup' | 'timeofday'

export type Timer = {
  id: string
  roomId: string
  title: string
  duration: number // seconds
  originalDuration?: number // seconds - the duration before nudge adjustments, restored on reset
  speaker?: string
  type: TimerType
  order: number
  adjustmentLog?: TimerAdjustment[]
}

export type TimerAdjustment = {
  timestamp: number
  delta: number // milliseconds added/subtracted
  deviceId: string
  reason: 'manual' | 'sync' | 'migration'
}

export type OperatorRole = 'lx' | 'ax' | 'vx' | 'sm' | 'foh' | 'custom'

export type CueTriggerType = 'timed' | 'fixed_time' | 'sequential' | 'follow' | 'floating'

export type CueAckState = 'pending' | 'done' | 'skipped'

// Legacy types remain exported for backward compatibility.
export type RoomConfig = {
  warningSec: number
  criticalSec: number
}

export type RoomStateLegacy = {
  activeTimerId: string | null
  isRunning: boolean
  startedAt: number | null // epoch ms
  elapsedOffset: number // ms
  progress: Record<string, number> // timerId -> elapsed ms
  showClock: boolean
  clockMode?: '24h' | 'ampm'
  message: {
    text: string
    visible: boolean
    color: MessageColor
  }
}

export type RoomLegacy = {
  id: string
  ownerId: string
  title: string
  timezone: string
  createdAt: number
  order?: number
  config: RoomConfig
  state: RoomStateLegacy
}

export type Tier = 'basic' | 'show_control' | 'production'

export type RoomFeatures = {
  localMode: boolean
  showControl: boolean
  powerpoint: boolean
  externalVideo: boolean
}

export type InviteConfig = {
  code: string
  enabled: boolean
  generatedAt: number
  generatedBy: string
}

export type Operator = {
  odUserId: string
  displayName?: string
  email?: string
  odRole: OperatorRole
  odRoleLabel?: string
  approvedAt: number
  approvedVia: 'invite_code' | 'direct'
}

export type BlockedUser = {
  odUserId: string
  blockedAt: number
  blockedBy: string
  reason?: string
}

export type RoomState = RoomStateLegacy & {
  currentTime?: number
  lastUpdate?: number
  activeLiveCueId?: string
}

export type Section = {
  id: string
  roomId: string
  title: string
  order: number
  notes?: string
  plannedDurationSec?: number
  plannedStartAt?: number
  createdAt?: number
  updatedAt?: number
}

export type Segment = {
  id: string
  roomId: string
  sectionId?: string
  title: string
  order: number
  plannedStartAt?: number
  plannedDurationSec?: number
  primaryTimerId?: string
  notes?: string
  createdAt?: number
  updatedAt?: number
}

export type Cue = {
  id: string
  roomId: string
  role: OperatorRole
  title: string
  notes?: string
  sectionId?: string
  segmentId?: string
  order?: number
  triggerType: CueTriggerType
  offsetMs?: number
  timeBase?: 'actual' | 'planned'
  targetTimeMs?: number
  afterCueId?: string
  approximatePosition?: number
  triggerNote?: string
  ackState?: CueAckState
  ackAt?: number
  ackBy?: string
  createdBy: string
  createdAt?: number
  updatedAt?: number
  editedBy?: string
  createdByRole?: OperatorRole
  editedByRole?: OperatorRole
  editNote?: string
}

export type CrewChatMessage = {
  id: string
  roomId: string
  senderId: string
  senderName?: string
  senderRole?: string
  message: string
  audience: 'all' | 'roles'
  roles?: string[]
  type?: 'text' | 'preset'
  presetId?: string
  createdAt: number
}

export type LiveCue = {
  id: string
  source: 'powerpoint' | 'external_video' | 'pdf'
  title: string
  duration?: number
  startedAt?: number
  status?: 'playing' | 'paused' | 'ended'
  config?: {
    warningSec?: number
    criticalSec?: number
  }
  metadata?: {
    slideNumber?: number
    totalSlides?: number
    slideNotes?: string
    filename?: string
    player?: string
    parentTimerId?: string
    autoAdvanceNext?: boolean
    videos?: {
      id?: number
      name?: string
      duration?: number
      elapsed?: number
      remaining?: number
      playing?: boolean
      status?: 'playing' | 'paused' | 'ended'
    }[]
    videoPlaying?: boolean
    videoDuration?: number
    videoElapsed?: number
    videoRemaining?: number
    videoTimingUnavailable?: boolean
  }
}

export type LiveCueRecord = {
  cue: LiveCue
  updatedAt: number
  source: 'companion' | 'controller'
}

// Transitional Room type that preserves legacy fields while adding tier/features.
export type Room = RoomLegacy & {
  tier?: Tier
  features?: RoomFeatures
  state: RoomState
  _version?: number
}

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting'

export type ControllerLock = {
  clientId: string
  deviceName?: string
  userId?: string
  userName?: string
  lockedAt: number
  lastHeartbeat: number
  roomId: string
}

export type ControllerLockState = 'authoritative' | 'read-only' | 'requesting' | 'displaced'

export type ControllerClient = {
  clientId: string
  deviceName?: string
  userId?: string
  userName?: string
  lastHeartbeat?: number
  clientType: 'controller' | 'viewer'
  role?: string
  tokenId?: string
  source?: 'cloud' | 'companion'
}
