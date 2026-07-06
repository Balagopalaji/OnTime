// rebuild-target: app-internal (apps/local-companion)
import type { ControlRequestClearReason } from '@ontime/interface-contracts';

// Re-exported for backwards compatibility: callers (and main.ts) historically
// imported ControlRequestClearReason from this module. The canonical wire
// definition now lives in @ontime/interface-contracts (U1 slice 6).
export type { ControlRequestClearReason };

export const CONTROL_REQUEST_TIMEOUT_MS = 30_000;

export type PendingControlRequestEntry = {
  requesterId: string;
  requesterName?: string;
  requesterUserId?: string;
  requesterUserName?: string;
  requestedAt: number;
};

export const getPendingControlReplacementReason = (
  current: PendingControlRequestEntry | undefined,
  incomingRequesterId: string,
  now: number,
  timeoutMs = CONTROL_REQUEST_TIMEOUT_MS,
): ControlRequestClearReason | null => {
  if (!current) return null;
  if (now - current.requestedAt >= timeoutMs) return 'timeout';
  if (current.requesterId !== incomingRequesterId) return 'superseded';
  return null;
};

export const shouldClearPendingControlByTimeout = (
  current: PendingControlRequestEntry | undefined,
  now: number,
  timeoutMs = CONTROL_REQUEST_TIMEOUT_MS,
): boolean => Boolean(current && now - current.requestedAt >= timeoutMs);

export const shouldClearPendingControlForRequester = (
  current: PendingControlRequestEntry | undefined,
  requesterId: string,
): boolean => Boolean(current && current.requesterId === requesterId);

export function normalizeRoomPin(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

export type ControllerLock = {
  clientId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  lockedAt: number;
  lastHeartbeat: number;
  roomId: string;
};

export function buildControllerLock(roomId: string, entry: {
  clientId: string;
  connectedAt: number;
  lastHeartbeat: number;
  deviceName?: string;
  userId?: string;
  userName?: string;
}): ControllerLock {
  return {
    clientId: entry.clientId,
    deviceName: entry.deviceName,
    userId: entry.userId,
    userName: entry.userName,
    lockedAt: entry.connectedAt,
    lastHeartbeat: entry.lastHeartbeat,
    roomId,
  };
}
