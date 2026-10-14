// rebuild-target: app-internal (apps/local-companion)
//
// LAN remote presentation snapshot adapter (ISSUE-002 S9a). Companion only
// relays: the local ppt-timer sidecar (role `presentation-publisher`) admits
// itself over loopback with a one-time token minted here, then publishes full
// `RemoteSnapshotV1` snapshots that this module validates, orders (epoch /
// sequence, via the contracts' `compareSnapshotOrder`), caches (latest full
// snapshot per sessionId), bootstraps to each newly admitted client of the
// room, and broadcasts to the room's paired viewers (S9b).
//
// Boundaries (kept narrow on purpose):
// - main.ts only constructs the hub with its shared helpers (`isLoopback`,
//   `emitToRoom`, clock) and registers it; nothing here imports main.ts,
//   Firebase, Electron, or a socket server. Cloud state is never mirrored in.
// - Viewers keep using the existing pairing JWT + `JOIN_ROOM` admission and the
//   20-device cap (all unchanged, in main.ts); they can only receive.
// - The publisher token is opaque, in-memory, single use and short lived. It is
//   NOT a JWT, so `verifyTokenPayload`/`JOIN_ROOM` can never accept it, and no
//   viewer/companion JWT is accepted here.
// - Envelope types live in `@ontime/interface-contracts` (types only);
//   validation uses the strict `parseRemoteSnapshotV1` contract parser.

import crypto from 'node:crypto';
import type {
  RemotePublisherAdmitRejectCode,
  RemotePublisherAdmitResult,
  RemotePublisherTokenResponse,
  RemoteSnapshotEndedEnvelope,
  RemoteSnapshotEnvelope,
  RemoteSnapshotPublishRejectCode,
  RemoteSnapshotPublishResult,
} from '@ontime/interface-contracts';
import { compareSnapshotOrder, parseRemoteSnapshotV1, type RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts';

export const PUBLISHER_TOKEN_PATH = '/api/remote-snapshot/publisher-token';
const PUBLISHER_TOKEN_TTL_MS = 60 * 1000;
const MAX_OUTSTANDING_TOKENS = 16;
const MAX_TOKEN_REQUEST_BYTES = 1024;
const MAX_ROOM_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 256;
const MAX_SESSIONS_PER_ROOM = 4;
const MAX_SESSIONS_TOTAL = 32;
const MAX_ENDED_SESSIONS = 64;

export type RemoteSnapshotDeps = {
  now: () => number;
  /** Shared loopback gate from main.ts. */
  isLoopback: (remoteAddress?: string | null) => boolean;
  /** Fan-out to every socket in a Socket.IO room (all io servers). */
  emitToRoom: (roomId: string, event: string, payload: unknown) => void;
  /** Injectable for tests; defaults to 256 random bits, base64url. */
  generateToken?: () => string;
};

/** Structural subset of a Socket.IO `Socket` (kept structural so tests need no server). */
export type RemoteSocketLike = {
  data: any;
  handshake?: { address?: string };
  conn?: { remoteAddress?: string };
  emit: (event: string, payload: unknown) => unknown;
  on?: (event: string, handler: (payload: unknown) => void) => unknown;
};

type TokenEntry = { roomId: string; expiresAt: number; usedAt?: number };

/** Latest accepted full snapshot of one presentation session, bound to the room that published it. */
type CachedSession = { roomId: string; snapshot: RemoteSnapshotV1 };

export type PublishAuthorization =
  | { ok: true; roomId: string; snapshot: RemoteSnapshotV1 }
  | { ok: false; code: RemoteSnapshotPublishRejectCode };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ROOM_ID_LENGTH;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function sendJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Reads a small JSON body; resolves `'too-large'` / `'invalid'` instead of throwing. */
function readSmallJson(req: any): Promise<unknown | 'too-large' | 'invalid'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_TOKEN_REQUEST_BYTES) {
        settle('too-large');
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        settle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        settle('invalid');
      }
    });
    req.on('error', () => settle('invalid'));
  });
}

export function createRemoteSnapshotHub(deps: RemoteSnapshotDeps) {
  const generateToken = deps.generateToken ?? (() => crypto.randomBytes(32).toString('base64url'));
  const tokens = new Map<string, TokenEntry>();
  // Insertion order == recency: a session is re-inserted on every accepted publish.
  const sessions = new Map<string, CachedSession>();
  // Sessions the operator ended; a late publish must not resurrect them. Bounded FIFO.
  const endedSessions = new Set<string>();

  function socketAddress(socket: RemoteSocketLike): string | undefined {
    return typeof socket.handshake?.address === 'string' ? socket.handshake.address : socket.conn?.remoteAddress;
  }

  function pruneTokens(now: number): void {
    for (const [hash, entry] of tokens) {
      if (entry.expiresAt <= now) tokens.delete(hash);
    }
  }

  function mintToken(roomId: string): RemotePublisherTokenResponse {
    const now = deps.now();
    pruneTokens(now);
    while (tokens.size >= MAX_OUTSTANDING_TOKENS) {
      const oldest = tokens.keys().next().value;
      if (oldest === undefined) break;
      tokens.delete(oldest);
    }
    const token = generateToken();
    const expiresAt = now + PUBLISHER_TOKEN_TTL_MS;
    tokens.set(hashToken(token), { roomId, expiresAt });
    return { roomId, token, expiresAt };
  }

  /**
   * Loopback HTTP route. Browsers are refused outright (Origin / Fetch-Metadata
   * headers, no CORS answer), so only a local non-browser process (the sidecar)
   * can mint. Returns true when a response was written.
   */
  function handleHttp(req: any, res: any): boolean {
    if (typeof req?.url !== 'string') return false;
    if (new URL(req.url, 'http://localhost').pathname !== PUBLISHER_TOKEN_PATH) return false;
    const headers = req.headers ?? {};
    if (!deps.isLoopback(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return true;
    }
    if (headers.origin !== undefined || headers['sec-fetch-site'] !== undefined) {
      sendJson(res, 403, { error: 'Forbidden' });
      return true;
    }
    const method = String(req.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      sendJson(res, 403, { error: 'Forbidden' });
      return true;
    }
    if (method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    void readSmallJson(req).then((body) => {
      if (body === 'too-large') {
        sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
        return;
      }
      const roomId = typeof asRecord(body)?.roomId === 'string' ? (asRecord(body)!.roomId as string).trim() : '';
      if (!isRoomId(roomId)) {
        sendJson(res, 400, { error: 'INVALID_ROOM' });
        return;
      }
      sendJson(res, 200, mintToken(roomId));
    });
    return true;
  }

  function admitResult(roomId: string, outcome: { admitted: true } | { admitted: false; code: RemotePublisherAdmitRejectCode }): RemotePublisherAdmitResult {
    return { type: 'REMOTE_PUBLISHER_ADMIT_RESULT', roomId, timestamp: deps.now(), ...outcome };
  }

  /**
   * Claims a one-time token for this socket. The token is consumed by any
   * presentation that gets past the format checks (even from a non-loopback
   * socket or the wrong room), so a leaked token cannot be probed.
   */
  function admitPublisher(socket: RemoteSocketLike, payload: unknown): RemotePublisherAdmitResult {
    const record = asRecord(payload);
    const roomId = record?.roomId;
    const token = record?.token;
    const respond = (code: RemotePublisherAdmitRejectCode | null): RemotePublisherAdmitResult => {
      const result = admitResult(typeof roomId === 'string' ? roomId : '', code === null ? { admitted: true } : { admitted: false, code });
      socket.emit('REMOTE_PUBLISHER_ADMIT_RESULT', result);
      return result;
    };
    if (
      record?.type !== 'REMOTE_PUBLISHER_ADMIT' ||
      !isRoomId(roomId) ||
      typeof token !== 'string' ||
      token.length === 0 ||
      token.length > MAX_TOKEN_LENGTH
    ) {
      return respond('INVALID_PAYLOAD');
    }
    const data = (socket.data ??= {});
    if (data.clientId !== undefined || data.clientType !== undefined || data.remotePublisherRoomId !== undefined) {
      return respond('ALREADY_JOINED');
    }
    const now = deps.now();
    const entry = tokens.get(hashToken(token));
    if (!entry) return respond('TOKEN_INVALID');
    if (entry.usedAt !== undefined) return respond('TOKEN_REUSED');
    entry.usedAt = now;
    if (entry.expiresAt <= now) return respond('TOKEN_EXPIRED');
    if (!deps.isLoopback(socketAddress(socket))) return respond('NOT_LOOPBACK');
    if (entry.roomId !== roomId) return respond('ROOM_MISMATCH');
    data.remotePublisherRoomId = roomId;
    return respond(null);
  }

  /**
   * Role + transport gate shared by publish and end. Only a socket admitted
   * through {@link admitPublisher} carries `remotePublisherRoomId`; paired LAN
   * viewers (JWT `JOIN_ROOM`) never do. Loopback is re-checked on every call as
   * defense in depth.
   */
  function admittedRoom(socket: RemoteSocketLike): { ok: true; roomId: string } | { ok: false; code: 'UNAUTHORIZED_ROLE' | 'NOT_LOOPBACK' } {
    const roomId = socket.data?.remotePublisherRoomId;
    if (typeof roomId !== 'string') return { ok: false, code: 'UNAUTHORIZED_ROLE' };
    if (!deps.isLoopback(socketAddress(socket))) return { ok: false, code: 'NOT_LOOPBACK' };
    return { ok: true, roomId };
  }

  /** Role + transport + shape gate for `REMOTE_SNAPSHOT_PUBLISH` (strict snapshot parser). */
  function authorizePublish(socket: RemoteSocketLike, payload: unknown): PublishAuthorization {
    const admitted = admittedRoom(socket);
    if (!admitted.ok) return admitted;
    const record = asRecord(payload);
    if (record?.type !== 'REMOTE_SNAPSHOT_PUBLISH' || !isRoomId(record.roomId)) return { ok: false, code: 'INVALID_PAYLOAD' };
    if (record.roomId !== admitted.roomId) return { ok: false, code: 'ROOM_MISMATCH' };
    const parsed = parseRemoteSnapshotV1(record.snapshot);
    if (!parsed.ok) return { ok: false, code: 'INVALID_SNAPSHOT' };
    return { ok: true, roomId: admitted.roomId, snapshot: parsed.value };
  }

  function envelope(roomId: string, snapshot: RemoteSnapshotV1): RemoteSnapshotEnvelope {
    return { type: 'REMOTE_SNAPSHOT', roomId, snapshot, timestamp: deps.now() };
  }

  function evictOldest(predicate: (session: CachedSession) => boolean): void {
    for (const [sessionId, session] of sessions) {
      if (predicate(session)) {
        sessions.delete(sessionId);
        return;
      }
    }
  }

  /**
   * Validates, orders, caches and broadcasts one full snapshot. A higher epoch
   * resets; duplicates and regressions are rejected and never replace the cache.
   */
  function publish(socket: RemoteSocketLike, payload: unknown): PublishAuthorization {
    const claimedRoom = asRecord(payload)?.roomId;
    const replyRoomId = typeof claimedRoom === 'string' ? claimedRoom : String(socket.data?.remotePublisherRoomId ?? '');
    const reply = (extra: Partial<Pick<RemoteSnapshotPublishResult, 'sessionId'>>, outcome: object) =>
      socket.emit('REMOTE_SNAPSHOT_PUBLISH_RESULT', {
        type: 'REMOTE_SNAPSHOT_PUBLISH_RESULT',
        roomId: replyRoomId,
        ...extra,
        timestamp: deps.now(),
        ...outcome,
      });
    const decision = authorizePublish(socket, payload);
    if (!decision.ok) {
      reply({}, { accepted: false, code: decision.code });
      return decision;
    }
    const { roomId, snapshot } = decision;
    const { sessionId } = snapshot;
    const rejected = (code: RemoteSnapshotPublishRejectCode, last?: { epoch: number; sequence: number }): PublishAuthorization => {
      reply({ sessionId }, { accepted: false, code, lastEpoch: last?.epoch, lastSequence: last?.sequence });
      return { ok: false, code };
    };
    if (endedSessions.has(sessionId)) return rejected('SESSION_ENDED');
    const cached = sessions.get(sessionId);
    if (cached && cached.roomId !== roomId) return rejected('SESSION_BOUND_TO_OTHER_ROOM');
    const last = cached ? { epoch: cached.snapshot.epoch, sequence: cached.snapshot.sequence } : null;
    const order = compareSnapshotOrder(last, snapshot);
    if (order === 'duplicate') return rejected('DUPLICATE', last ?? undefined);
    if (order === 'regression') return rejected('REGRESSION', last ?? undefined);

    sessions.delete(sessionId);
    sessions.set(sessionId, { roomId, snapshot });
    let inRoom = 0;
    for (const session of sessions.values()) if (session.roomId === roomId) inRoom += 1;
    if (inRoom > MAX_SESSIONS_PER_ROOM) evictOldest((session) => session.roomId === roomId);
    if (sessions.size > MAX_SESSIONS_TOTAL) evictOldest(() => true);

    reply({ sessionId }, { accepted: true, order, epoch: snapshot.epoch, sequence: snapshot.sequence });
    deps.emitToRoom(roomId, 'REMOTE_SNAPSHOT', envelope(roomId, snapshot));
    return decision;
  }

  /** Bootstrap: the cached latest full snapshot of every session in the room goes to the new client first. */
  function bootstrapViewer(socket: RemoteSocketLike, roomId: string): void {
    for (const session of sessions.values()) {
      if (session.roomId === roomId) socket.emit('REMOTE_SNAPSHOT', envelope(roomId, session.snapshot));
    }
  }

  /** The operator stopped sharing: drop the cache, tell viewers, and refuse a resurrecting publish. */
  function endSession(socket: RemoteSocketLike, payload: unknown): void {
    const admitted = admittedRoom(socket);
    const record = asRecord(payload);
    if (!admitted.ok || record?.type !== 'REMOTE_SNAPSHOT_END' || record.roomId !== admitted.roomId) return;
    const sessionId = record.sessionId;
    if (typeof sessionId !== 'string' || sessions.get(sessionId)?.roomId !== admitted.roomId) return;
    sessions.delete(sessionId);
    endedSessions.add(sessionId);
    if (endedSessions.size > MAX_ENDED_SESSIONS) endedSessions.delete(endedSessions.values().next().value as string);
    const ended: RemoteSnapshotEndedEnvelope = { type: 'REMOTE_SNAPSHOT_ENDED', roomId: admitted.roomId, sessionId, timestamp: deps.now() };
    deps.emitToRoom(admitted.roomId, 'REMOTE_SNAPSHOT_ENDED', ended);
  }

  /** Room deleted: nothing about it may linger (cached snapshots, unclaimed tokens). */
  function clearRoom(roomId: string): void {
    for (const [sessionId, session] of sessions) if (session.roomId === roomId) sessions.delete(sessionId);
    for (const [hash, entry] of tokens) if (entry.roomId === roomId) tokens.delete(hash);
  }

  /** Registers the publisher-side handlers on a new socket connection. */
  function registerSocket(socket: RemoteSocketLike): void {
    socket.on?.('REMOTE_PUBLISHER_ADMIT', (payload) => {
      admitPublisher(socket, payload);
    });
    socket.on?.('REMOTE_SNAPSHOT_PUBLISH', (payload) => {
      publish(socket, payload);
    });
    socket.on?.('REMOTE_SNAPSHOT_END', (payload) => endSession(socket, payload));
  }

  return { handleHttp, admitPublisher, authorizePublish, publish, bootstrapViewer, endSession, clearRoom, registerSocket };
}

export type RemoteSnapshotHub = ReturnType<typeof createRemoteSnapshotHub>;
