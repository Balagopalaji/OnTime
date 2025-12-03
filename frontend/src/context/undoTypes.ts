import type { Room, Timer } from '../types'

export type RoomUndoSnapshot = {
  room: Room
  timers: Timer[]
}

export type TimerUndoSnapshot = {
  timer: Timer
  progress: number
}

export type RoomUndoEntry = {
  kind: 'room'
  id: string
  roomId: string
  expiresAt: number
  snapshot: RoomUndoSnapshot
}

export type TimerUndoEntry = {
  kind: 'timer'
  id: string
  roomId: string
  expiresAt: number
  snapshot: TimerUndoSnapshot
}

export type UndoEntry = RoomUndoEntry | TimerUndoEntry
