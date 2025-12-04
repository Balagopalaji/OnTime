/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { ConnectionStatus, Room, Timer, MessageColor } from '../types'

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

export type DataContextValue = {
  rooms: Room[]
  connectionStatus: ConnectionStatus
  setConnectionStatus: (status: ConnectionStatus) => void
  pendingRooms: Set<string>
  pendingRoomPlaceholders: Array<{ roomId: string; title: string; expiresAt: number; createdAt: number }>
  pendingTimers: Record<string, Set<string>>
  pendingTimerPlaceholders: Record<
    string,
    Array<{ timerId: string; title: string; order: number; expiresAt: number }>
  >
  undoRoomDelete: () => Promise<void>
  redoRoomDelete: () => Promise<void>
  undoTimerDelete: (roomId: string) => Promise<void>
  redoTimerDelete: (roomId: string) => Promise<void>
  clearUndoStacks: () => Promise<void>
  getRoom: (roomId: string) => Room | undefined
  getTimers: (roomId: string) => Timer[]
  createRoom: (input: CreateRoomInput) => Promise<Room>
  deleteRoom: (roomId: string) => Promise<void>
  createTimer: (roomId: string, input: CreateTimerInput) => Promise<Timer>
  updateTimer: (
    roomId: string,
    timerId: string,
    patch: Partial<Omit<Timer, 'id' | 'roomId'>>,
  ) => Promise<void>
  updateRoomMeta: (
    roomId: string,
    patch: Partial<Pick<Room, 'title' | 'timezone'>>,
  ) => Promise<void>
  restoreTimer: (roomId: string, timer: Timer) => Promise<void>
  resetTimerProgress: (roomId: string, timerId: string) => Promise<void>
  deleteTimer: (roomId: string, timerId: string) => Promise<void>
  moveTimer: (
    roomId: string,
    timerId: string,
    direction: 'up' | 'down',
  ) => Promise<void>
  reorderTimer: (roomId: string, timerId: string, targetIndex: number) => Promise<void>
  setActiveTimer: (roomId: string, timerId: string) => Promise<void>
  startTimer: (roomId: string, timerId?: string) => Promise<void>
  pauseTimer: (roomId: string) => Promise<void>
  resetTimer: (roomId: string) => Promise<void>
  nudgeTimer: (roomId: string, deltaMs: number) => Promise<void>
  setClockMode: (roomId: string, enabled: boolean) => Promise<void>
  updateMessage: (
    roomId: string,
    message: Partial<{ text: string; color: MessageColor; visible: boolean }>,
  ) => Promise<void>
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
