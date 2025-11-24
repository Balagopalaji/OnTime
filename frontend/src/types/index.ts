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

export type RoomConfig = {
  warningSec: number
  criticalSec: number
}

export type RoomState = {
  activeTimerId: string | null
  isRunning: boolean
  startedAt: number | null // epoch ms
  elapsedOffset: number // ms
  progress: Record<string, number> // timerId -> elapsed ms
  showClock: boolean
  message: {
    text: string
    visible: boolean
    color: MessageColor
  }
}

export type Room = {
  id: string
  ownerId: string
  title: string
  timezone: string
  createdAt: number
  config: RoomConfig
  state: RoomState
}

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting'
