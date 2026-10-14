// rebuild-target: app-internal (apps/local-companion)
//
// LAN remote presentation snapshot adapter (ISSUE-002 S9a). Companion only
// relays: the local ppt-timer sidecar (role `presentation-publisher`) admits
// itself over loopback with a one-time token minted here, then publishes full
// `RemoteSnapshotV1` snapshots that this module validates, caches, and fans
// out to the room's paired viewers (S9b).
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
  RemoteSnapshotPublishRejectCode,
} from '@ontime/interface-contracts';
import { parseRemoteSnapshotV1, type RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts';

export const PUBLISHER_TOKEN_PATH = '/api/remote-snapshot/publisher-token';
const PUBLISHER_TOKEN_TTL_MS = 60 * 1000;
const MAX_OUTSTANDING_TOKENS = 16;
const MAX_TOKEN_REQUEST_BYTES = 1024;
const MAX_ROOM_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 256;

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
   * Role + transport + shape gate for `REMOTE_SNAPSHOT_PUBLISH`. Only a socket
   * admitted through {@link admitPublisher} carries `remotePublisherRoomId`;
   * paired LAN viewers (JWT `JOIN_ROOM`) never do. Loopback is re-checked on
   * every publish as defense in depth.
   */
  function authorizePublish(socket: RemoteSocketLike, payload: unknown): PublishAuthorization {
    const admittedRoomId = socket.data?.remotePublisherRoomId;
    if (typeof admittedRoomId !== 'string') return { ok: false, code: 'UNAUTHORIZED_ROLE' };
    if (!deps.isLoopback(socketAddress(socket))) return { ok: false, code: 'NOT_LOOPBACK' };
    const record = asRecord(payload);
    if (record?.type !== 'REMOTE_SNAPSHOT_PUBLISH' || !isRoomId(record.roomId)) return { ok: false, code: 'INVALID_PAYLOAD' };
    if (record.roomId !== admittedRoomId) return { ok: false, code: 'ROOM_MISMATCH' };
    const parsed = parseRemoteSnapshotV1(record.snapshot);
    if (!parsed.ok) return { ok: false, code: 'INVALID_SNAPSHOT' };
    return { ok: true, roomId: admittedRoomId, snapshot: parsed.value };
  }

  /** Registers the publisher-side handlers on a new socket connection. */
  function registerSocket(socket: RemoteSocketLike): void {
    socket.on?.('REMOTE_PUBLISHER_ADMIT', (payload) => {
      admitPublisher(socket, payload);
    });
  }

  return { handleHttp, admitPublisher, authorizePublish, registerSocket };
}

export type RemoteSnapshotHub = ReturnType<typeof createRemoteSnapshotHub>;
