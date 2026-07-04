// rebuild-target: app-internal (apps/local-companion)
export const CONTROL_AUDIT_ENTRY_LIMIT = 50;

export type ControlAuditEntry = {
  action: 'request' | 'force' | 'handover' | 'deny';
  actorId: string;
  actorUserId?: string;
  actorUserName?: string;
  targetId?: string;
  timestamp: number;
  deviceName?: string;
  status?: 'accepted' | 'denied';
};

export type ControlAuditStore = Map<string, ControlAuditEntry[]>;

export type AppendControlAuditDeps = {
  store: ControlAuditStore;
  scheduleWrite: () => void;
};

export function appendControlAudit(
  roomId: string,
  entry: ControlAuditEntry,
  { store, scheduleWrite }: AppendControlAuditDeps,
): void {
  const list = store.get(roomId) ?? [];
  list.push(entry);
  const trimmed = list.slice(-CONTROL_AUDIT_ENTRY_LIMIT);
  store.set(roomId, trimmed);
  scheduleWrite();
}
