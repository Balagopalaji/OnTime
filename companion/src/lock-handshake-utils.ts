export type PendingHandshakeEntry = {
  socketId: string;
  startedAt: number;
};

export type PendingHandshakeDecision = {
  reject: boolean;
  clearExisting: boolean;
};

type ResolvePendingHandshakeConflictArgs = {
  pending: PendingHandshakeEntry | undefined;
  now: number;
  ttlMs: number;
  pendingSocketConnected: boolean;
  incomingSocketId: string;
  idempotentSameSocketJoin: boolean;
};

export function resolvePendingHandshakeConflict(
  args: ResolvePendingHandshakeConflictArgs,
): PendingHandshakeDecision {
  const { pending } = args;
  if (!pending) {
    return { reject: false, clearExisting: false };
  }

  const age = args.now - pending.startedAt;
  if (age >= args.ttlMs || !args.pendingSocketConnected) {
    return { reject: false, clearExisting: true };
  }

  if (args.idempotentSameSocketJoin && pending.socketId === args.incomingSocketId) {
    return { reject: false, clearExisting: true };
  }

  return { reject: true, clearExisting: false };
}

export function shouldDeleteClientEntryOnDisconnect(
  storedSocketId: string | undefined,
  disconnectSocketId: string,
): boolean {
  return storedSocketId === disconnectSocketId;
}

type LockEntry = {
  clientId: string;
  socketId: string;
};

type ClientEntry = {
  clientId: string;
  socketId: string;
  clientType: 'controller' | 'viewer';
  deviceName?: string;
  userId?: string;
  userName?: string;
};

export type LockDisconnectResolution =
  | { action: 'none' }
  | {
      action: 'clear';
      clearPending: boolean;
    }
  | {
      action: 'transfer';
      clearPending: boolean;
      target: {
        clientId: string;
        socketId: string;
        deviceName?: string;
        userId?: string;
        userName?: string;
      };
    };

type ResolveLockDisconnectArgs = {
  lock: LockEntry | undefined;
  disconnectSocketId: string;
  pendingRequesterId: string | undefined;
  clients: ClientEntry[];
  isSocketActive: (socketId: string) => boolean;
};

export function resolveLockOnDisconnect(args: ResolveLockDisconnectArgs): LockDisconnectResolution {
  const { lock } = args;
  if (!lock || lock.socketId !== args.disconnectSocketId) {
    return { action: 'none' };
  }

  const activeControllers = args.clients.filter(
    (entry) =>
      entry.clientType === 'controller' &&
      entry.socketId !== args.disconnectSocketId &&
      args.isSocketActive(entry.socketId),
  );

  const sameClientReconnect = activeControllers.find((entry) => entry.clientId === lock.clientId);
  if (sameClientReconnect) {
    return {
      action: 'transfer',
      clearPending: true,
      target: {
        clientId: sameClientReconnect.clientId,
        socketId: sameClientReconnect.socketId,
        deviceName: sameClientReconnect.deviceName,
        userId: sameClientReconnect.userId,
        userName: sameClientReconnect.userName,
      },
    };
  }

  if (args.pendingRequesterId) {
    const pendingTarget = activeControllers.find((entry) => entry.clientId === args.pendingRequesterId);
    if (pendingTarget) {
      return {
        action: 'transfer',
        clearPending: true,
        target: {
          clientId: pendingTarget.clientId,
          socketId: pendingTarget.socketId,
          deviceName: pendingTarget.deviceName,
          userId: pendingTarget.userId,
          userName: pendingTarget.userName,
        },
      };
    }
  }

  return {
    action: 'clear',
    clearPending: true,
  };
}
