export type MessageColor = 'green' | 'yellow' | 'red' | 'blue' | 'white' | 'none'

export type TimerType = 'countdown' | 'countup' | 'timeofday'

export type Timer = {
  id: string
  roomId: string
  title: string
  duration: number // seconds
  speaker?: string
  type: TimerType
  order: number
}

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

export type RoomState = RoomStateLegacy & {
  currentTime?: number
  lastUpdate?: number
  activeLiveCueId?: string
}

// Transitional Room type that preserves legacy fields while adding tier/features.
export type Room = RoomLegacy & {
  tier?: Tier
  features?: RoomFeatures
  state: RoomState
  _version?: number
}

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting'
