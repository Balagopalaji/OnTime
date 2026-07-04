import {
  CONTROL_REQUEST_TIMEOUT_MS,
  type PendingControlRequestEntry,
} from './control-lock-utils';

export type PendingControlTimeoutStore = Map<string, NodeJS.Timeout>;
export type PendingControlRequestStore = Map<string, PendingControlRequestEntry>;
export type ScheduleTimeoutFn = (callback: () => void, delay: number) => NodeJS.Timeout;
export type ClearTimeoutFn = (timeout: NodeJS.Timeout) => void;

export type SchedulePendingControlRequestTimeoutDeps = {
  pendingControlTimeouts: PendingControlTimeoutStore;
  pendingControlRequests: PendingControlRequestStore;
  clearPendingControlRequest: (roomId: string, reason: 'timeout') => void;
  now?: () => number;
  setTimeoutFn?: ScheduleTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
  timeoutMs?: number;
};

export function schedulePendingControlRequestTimeout(
  roomId: string,
  requestedAt: number,
  deps: SchedulePendingControlRequestTimeoutDeps,
): void {
  const {
    pendingControlTimeouts,
    pendingControlRequests,
    clearPendingControlRequest,
    now = Date.now,
    setTimeoutFn = setTimeout as ScheduleTimeoutFn,
    clearTimeoutFn = clearTimeout as ClearTimeoutFn,
    timeoutMs = CONTROL_REQUEST_TIMEOUT_MS,
  } = deps;
  const existing = pendingControlTimeouts.get(roomId);
  if (existing) {
    clearTimeoutFn(existing);
  }
  const delay = Math.max(0, timeoutMs - (now() - requestedAt));
  const timer = setTimeoutFn(() => {
    pendingControlTimeouts.delete(roomId);
    const pending = pendingControlRequests.get(roomId);
    if (!pending) return;
    if (pending.requestedAt !== requestedAt) return;
    clearPendingControlRequest(roomId, 'timeout');
  }, delay);
  pendingControlTimeouts.set(roomId, timer);
}
