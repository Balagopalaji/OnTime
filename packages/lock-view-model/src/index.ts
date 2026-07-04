// rebuild-target: packages/lock-view-model
import type {
  Room,
  ControllerLock,
  ControllerLockState,
  ControllerClient,
  ConnectionStatus,
} from '@ontime/shared-types'

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
  const lock = controllerLocks[roomId]
  if (!lock) return 'authoritative'
  if (controlDisplacements[roomId]) return 'displaced'
  if (lock.clientId === clientId) return 'authoritative'
  const pending = pendingControlRequests[roomId]
  if (pending?.requesterId === clientId) return 'requesting'
  return 'read-only'
}

export const reduceControlDisplacementsForLockUpdate = ({
  current,
  roomId,
  previousLock,
  nextLock,
  clientId,
  timestamp,
}: {
  current: Record<
    string,
    | {
        takenAt: number
        takenById: string
        takenByName?: string
        takenByUserId?: string
        takenByUserName?: string
      }
    | null
    | undefined
  >
  roomId: string
  previousLock: ControllerLock | null | undefined
  nextLock: ControllerLock | null
  clientId: string
  timestamp: number
}): Record<
  string,
  | {
      takenAt: number
      takenById: string
      takenByName?: string
      takenByUserId?: string
      takenByUserName?: string
    }
  | null
  | undefined
> => {
  if (!nextLock) {
    return { ...current, [roomId]: null }
  }
  if (previousLock?.clientId === clientId && nextLock.clientId !== clientId) {
    return {
      ...current,
      [roomId]: {
        takenAt: timestamp,
        takenById: nextLock.clientId,
        takenByName: nextLock.deviceName,
        takenByUserId: nextLock.userId,
        takenByUserName: nextLock.userName,
      },
    }
  }
  return current
}

export const resolveLockAuthoritySource = ({
  room,
  connectionStatus,
}: {
  room?: Pick<Room, 'id'>
  connectionStatus: ConnectionStatus
}): 'cloud' | 'companion' => {
  if (room && connectionStatus === 'online') {
    return 'cloud'
  }
  return 'companion'
}

export type ControlRequestStatusPayload = {
  type: 'CONTROL_REQUEST_STATUS'
  roomId: string
  requesterId: string
  status: 'queued' | 'cleared'
  reason?: 'lock_changed' | 'request_denied' | 'requester_disconnected' | 'timeout' | 'room_unsubscribed' | 'superseded'
  requestedAt: number
  timestamp: number
}

export type ControlRequest = {
  requesterId: string
  requesterName?: string
  requesterUserId?: string
  requesterUserName?: string
  requestedAt: number
}

export type ControlDenial = {
  requesterId: string
  reason?: string
  deniedByName?: string
  deniedByUserId?: string
  deniedByUserName?: string
  deniedAt: number
}

const CONTROL_REQUEST_PENDING_TTL_MS = 120_000

export const shouldExpirePendingControlRequest = (
  requestedAt: number,
  now: number,
  ttlMs = CONTROL_REQUEST_PENDING_TTL_MS,
) => now - requestedAt >= ttlMs

export const prunePendingControlRequests = <T extends { requestedAt: number }>(
  pending: Record<string, T | null>,
  now: number,
  ttlMs = CONTROL_REQUEST_PENDING_TTL_MS,
) => {
  const expiredRoomIds: string[] = []
  const next: Record<string, T | null> = {}
  Object.entries(pending).forEach(([roomId, value]) => {
    if (!value) {
      next[roomId] = value
      return
    }
    if (shouldExpirePendingControlRequest(value.requestedAt, now, ttlMs)) {
      next[roomId] = null
      expiredRoomIds.push(roomId)
      return
    }
    next[roomId] = value
  })
  return { next, expiredRoomIds }
}

type RoomControlLifecycleSlices = {
  controlRequests: Record<string, ControlRequest | null>
  pendingControlRequests: Record<string, ControlRequest | null>
  controlDenials: Record<string, ControlDenial | null>
  controlDisplacements: Record<
    string,
    { takenAt: number; takenById: string; takenByName?: string; takenByUserId?: string; takenByUserName?: string } | null
  >
  controlErrors: Record<string, { code: string; message: string; receivedAt: number } | null>
  roomClients: Record<string, ControllerClient[]>
}

export const clearRoomControlLifecycleState = (
  roomId: string,
  slices: RoomControlLifecycleSlices,
  options?: { clearRoomClients?: boolean },
): RoomControlLifecycleSlices => {
  const controlRequests = { ...slices.controlRequests }
  delete controlRequests[roomId]
  const pendingControlRequests = { ...slices.pendingControlRequests }
  delete pendingControlRequests[roomId]
  const controlDenials = { ...slices.controlDenials }
  delete controlDenials[roomId]
  const controlDisplacements = { ...slices.controlDisplacements }
  delete controlDisplacements[roomId]
  const controlErrors = { ...slices.controlErrors }
  delete controlErrors[roomId]
  const roomClients = { ...slices.roomClients }
  if (options?.clearRoomClients) {
    delete roomClients[roomId]
  }
  return {
    controlRequests,
    pendingControlRequests,
    controlDenials,
    controlDisplacements,
    controlErrors,
    roomClients,
  }
}

export const reducePendingControlRequestByStatus = (
  current: Record<string, ControlRequest | null>,
  payload: ControlRequestStatusPayload,
  clientId: string,
): Record<string, ControlRequest | null> => {
  if (payload.requesterId !== clientId) return current
  if (payload.status === 'queued') {
    return {
      ...current,
      [payload.roomId]: {
        requesterId: payload.requesterId,
        requestedAt: payload.requestedAt,
      },
    }
  }
  const existing = current[payload.roomId]
  if (!existing) return current
  if (
    existing.requesterId !== payload.requesterId
    || existing.requestedAt !== payload.requestedAt
  ) {
    return current
  }
  return {
    ...current,
    [payload.roomId]: null,
  }
}

export const reduceControlRequestsByStatus = (
  current: Record<string, ControlRequest | null>,
  payload: ControlRequestStatusPayload,
): Record<string, ControlRequest | null> => {
  if (payload.status !== 'cleared') return current
  const existing = current[payload.roomId]
  if (!existing) return current
  if (
    existing.requesterId !== payload.requesterId
    || existing.requestedAt !== payload.requestedAt
  ) {
    return current
  }
  return {
    ...current,
    [payload.roomId]: null,
  }
}

export const shouldResetQueuedLockReplayOnSocketChange = (
  previousSocket: unknown,
  nextSocket: unknown,
): boolean => Boolean(previousSocket && nextSocket && previousSocket !== nextSocket)
