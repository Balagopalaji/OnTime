import { app, Menu, Tray, nativeImage, clipboard, shell, dialog } from 'electron';
import { createServer, Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer, Server as HttpsServer } from 'node:https';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { machineId } from 'node-machine-id';
import selfsigned from 'selfsigned';

let tray: Tray | null = null;

const APP_LABEL = 'OnTime Companion';
const MODE_LABEL = 'Minimal Mode';
const COMPANION_MODE = 'minimal';
const COMPANION_VERSION = '0.1.0';
const INTERFACE_VERSION = '1.2.0';
const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const TOKEN_SERVICE = 'OnTime Companion Token';
const TOKEN_ACCOUNT = 'default';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://[::1]:5173',
  'http://[::1]:3000',
  // Hosted Firebase web app
  'https://stagetime-2d3df.web.app',
  'https://stagetime-2d3df.firebaseapp.com',
  // Wildcards for other OnTime Firebase deployments
  'https://stagetime-*.web.app',
  'https://stagetime-*.firebaseapp.com'
];
const CACHE_VERSION = 2;
const CACHE_WRITE_DEBOUNCE_MS = 2000;
const PENDING_HANDSHAKE_TTL_MS = 10_000;
const CONTROL_REQUEST_TIMEOUT_MS = 30_000;

type JoinRoomPayload = {
  type: 'JOIN_ROOM';
  roomId: string;
  token: string;
  clientType?: 'controller' | 'viewer';
  clientId?: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  ownerId?: string;
  takeOver?: boolean;
  interfaceVersion?: string;
};

type ControllerLock = {
  clientId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  lockedAt: number;
  lastHeartbeat: number;
  roomId: string;
};

type HeartbeatPayload = {
  type: 'HEARTBEAT';
  roomId: string;
  clientId: string;
  timestamp: number;
};

type ControllerLockState = {
  type: 'CONTROLLER_LOCK_STATE';
  roomId: string;
  lock: ControllerLock | null;
  timestamp: number;
};

type RequestControlPayload = {
  type: 'REQUEST_CONTROL';
  roomId: string;
  clientId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  timestamp: number;
};

type ControlRequestReceived = {
  type: 'CONTROL_REQUEST_RECEIVED';
  roomId: string;
  requesterId: string;
  requesterName?: string;
  requesterUserId?: string;
  requesterUserName?: string;
  timestamp: number;
};

type ForceTakeoverPayload = {
  type: 'FORCE_TAKEOVER';
  roomId: string;
  clientId: string;
  pin?: string;
  reauthenticated?: boolean;
  timestamp: number;
};

type HandOverPayload = {
  type: 'HAND_OVER';
  roomId: string;
  targetClientId: string;
  timestamp: number;
};

type DenyControlPayload = {
  type: 'DENY_CONTROL';
  roomId: string;
  requesterId: string;
  timestamp: number;
};

type ControlRequestDenied = {
  type: 'CONTROL_REQUEST_DENIED';
  roomId: string;
  requesterId: string;
  timestamp: number;
  reason?: string;
  deniedByName?: string;
  deniedByUserId?: string;
  deniedByUserName?: string;
};

type RoomPinState = {
  type: 'ROOM_PIN_STATE';
  roomId: string;
  pin: string | null;
  updatedAt: number;
};

type SetRoomPinPayload = {
  type: 'SET_ROOM_PIN';
  roomId: string;
  pin?: string | null;
  timestamp: number;
};

type RoomClientsState = {
  type: 'ROOM_CLIENTS_STATE';
  roomId: string;
  clients: Array<{
    clientId: string;
    deviceName?: string;
    userId?: string;
    userName?: string;
    clientType: 'controller' | 'viewer';
  }>;
  timestamp: number;
};

type HandshakeAck = {
  type: 'HANDSHAKE_ACK';
  success: true;
  companionMode: typeof COMPANION_MODE;
  companionVersion: string;
  interfaceVersion: string;
  capabilities: {
    powerpoint: boolean;
    externalVideo: boolean;
    fileOperations: boolean;
  };
  systemInfo: {
    platform: NodeJS.Platform;
    hostname: string;
  };
};

type HandshakeError = {
  type: 'HANDSHAKE_ERROR';
  code: 'INVALID_TOKEN' | 'INVALID_PAYLOAD' | 'CONTROLLER_TAKEN';
  message: string;
};

type RoomState = {
  activeTimerId: string | null;
  isRunning: boolean;
  currentTime: number;
  lastUpdate: number;
  elapsedOffset?: number;
  progress?: Record<string, number>;
};

type TimerActionPayload = {
  type: 'TIMER_ACTION';
  action: 'START' | 'PAUSE' | 'RESET';
  roomId: string;
  timerId: string;
  timestamp?: number;
  clientId?: string;
  currentTime?: number; // Optional: elapsed time to use when starting (for stored progress)
};

type RoomStateSnapshot = {
  type: 'ROOM_STATE_SNAPSHOT';
  roomId: string;
  state: RoomState;
  timestamp: number;
};

type RoomStateDelta = {
  type: 'ROOM_STATE_DELTA';
  roomId: string;
  changes: Partial<RoomState>;
  clientId?: string;
  timestamp: number;
};

type RoomStatePatchPayload = {
  type: 'ROOM_STATE_PATCH';
  roomId: string;
  changes: Partial<RoomState>;
  clientId?: string;
  timestamp?: number;
};

type TimerType = 'countdown' | 'countup' | 'timeofday';

type Timer = {
  id: string;
  roomId: string;
  title: string;
  duration: number; // seconds
  originalDuration?: number; // seconds - the duration before nudge adjustments
  speaker?: string;
  type: TimerType;
  order: number;
};

type CreateTimerPayload = {
  type: 'CREATE_TIMER';
  roomId: string;
  timer: Partial<Timer>;
  clientId?: string;
  timestamp?: number;
};

type UpdateTimerPayload = {
  type: 'UPDATE_TIMER';
  roomId: string;
  timerId: string;
  changes: Partial<Timer>;
  clientId?: string;
  timestamp?: number;
};

type DeleteTimerPayload = {
  type: 'DELETE_TIMER';
  roomId: string;
  timerId: string;
  clientId?: string;
  timestamp?: number;
};

type ReorderTimersPayload = {
  type: 'REORDER_TIMERS';
  roomId: string;
  timerIds: string[];
  clientId?: string;
  timestamp?: number;
};

type SyncRoomStatePayload = {
  type: 'SYNC_ROOM_STATE';
  roomId: string;
  state: RoomState;
  timers?: Timer[];
  sourceClientId?: string;
  timestamp?: number;
};

type TimerError = {
  type: 'TIMER_ERROR';
  roomId: string;
  code: 'INVALID_PAYLOAD' | 'INVALID_FIELDS' | 'NOT_FOUND';
  message: string;
  clientId?: string;
  timestamp: number;
};

type TimerCreated = {
  type: 'TIMER_CREATED';
  roomId: string;
  timer: Timer;
  clientId?: string;
  timestamp: number;
};

type TimerUpdated = {
  type: 'TIMER_UPDATED';
  roomId: string;
  timerId: string;
  changes: Partial<Timer>;
  clientId?: string;
  timestamp: number;
};

type TimerDeleted = {
  type: 'TIMER_DELETED';
  roomId: string;
  timerId: string;
  clientId?: string;
  timestamp: number;
};

type TimersReordered = {
  type: 'TIMERS_REORDERED';
  roomId: string;
  timerIds: string[];
  clientId?: string;
  timestamp: number;
};

let io: SocketIOServer | null = null;
let ioSecure: SocketIOServer | null = null;
let httpServer: HttpServer | null = null;
let httpsServer: HttpsServer | null = null;
let tokenServerV4: HttpServer | null = null;
let tokenServerV6: HttpServer | null = null;
let tokenServerTlsV4: HttpsServer | null = null;
let tokenServerTlsV6: HttpsServer | null = null;
const ioServers: SocketIOServer[] = [];

function emitToRoom(roomId: string, event: string, payload: unknown) {
  ioServers.forEach((server) => {
    server.to(roomId).emit(event, payload);
  });
}
const roomStateStore: Map<string, RoomState> = new Map();
const roomTimersStore: Map<string, Map<string, Timer>> = new Map();
const roomControllerStore: Map<string, {
  clientId: string;
  socketId: string;
  connectedAt: number;
  lastHeartbeat: number;
  deviceName?: string;
  userId?: string;
  userName?: string;
}> = new Map();
const roomClientStore: Map<string, Map<string, {
  socketId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  clientType: 'controller' | 'viewer';
}>> = new Map();
const pendingHandshakeStore: Map<string, { socketId: string; startedAt: number }> = new Map();
const pendingControlRequests: Map<string, {
  requesterId: string;
  requesterName?: string;
  requesterUserId?: string;
  requesterUserName?: string;
  requestedAt: number;
}> = new Map();
const roomControlAuditStore: Map<string, Array<{
  action: 'request' | 'force' | 'handover' | 'deny';
  actorId: string;
  actorUserId?: string;
  actorUserName?: string;
  targetId?: string;
  timestamp: number;
  deviceName?: string;
  status?: 'accepted' | 'denied';
}>> = new Map();
const roomPinStore: Map<string, {
  pin: string;
  updatedAt: number;
  setBy?: string;
  setByUserId?: string;
  setByUserName?: string;
}> = new Map();
const roomOwnerStore: Map<string, {
  ownerId: string;
  ownerName?: string;
  updatedAt: number;
  setBy?: string;
}> = new Map();
let currentToken: string | null = null;
let currentTokenExpiresAt: number | null = null;
let jwtSecret: string | null = null;
let cacheWriteTimer: NodeJS.Timeout | null = null;
let lastWriteTs = 0;
let ffprobeMissingWarned = false;
let ffprobePath: string | null = null;

function getRoomClients(roomId: string): Map<string, {
  socketId: string;
  deviceName?: string;
  userId?: string;
  userName?: string;
  clientType: 'controller' | 'viewer';
}> {
  if (!roomClientStore.has(roomId)) {
    roomClientStore.set(roomId, new Map());
  }
  return roomClientStore.get(roomId)!;
}

function buildControllerLock(roomId: string, entry: {
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

function emitControllerLockState(roomId: string) {
  const entry = roomControllerStore.get(roomId);
  const payload: ControllerLockState = {
    type: 'CONTROLLER_LOCK_STATE',
    roomId,
    lock: entry ? buildControllerLock(roomId, entry) : null,
    timestamp: Date.now(),
  };
  emitToRoom(roomId, 'CONTROLLER_LOCK_STATE', payload);
}

function emitControllerLockStateToSocket(socket: Socket, roomId: string) {
  const entry = roomControllerStore.get(roomId);
  const payload: ControllerLockState = {
    type: 'CONTROLLER_LOCK_STATE',
    roomId,
    lock: entry ? buildControllerLock(roomId, entry) : null,
    timestamp: Date.now(),
  };
  socket.emit('CONTROLLER_LOCK_STATE', payload);
}

function normalizeRoomPin(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

function emitRoomPinStateToSocket(socket: Socket, roomId: string) {
  const entry = roomPinStore.get(roomId);
  const payload: RoomPinState = {
    type: 'ROOM_PIN_STATE',
    roomId,
    pin: entry?.pin ?? null,
    updatedAt: entry?.updatedAt ?? Date.now(),
  };
  socket.emit('ROOM_PIN_STATE', payload);
}

function emitRoomPinStateToController(roomId: string) {
  const entry = roomControllerStore.get(roomId);
  if (!entry) return;
  ioServers.forEach((server) => {
    server.to(entry.socketId).emit('ROOM_PIN_STATE', {
      type: 'ROOM_PIN_STATE',
      roomId,
      pin: roomPinStore.get(roomId)?.pin ?? null,
      updatedAt: roomPinStore.get(roomId)?.updatedAt ?? Date.now(),
    } satisfies RoomPinState);
  });
}

function emitRoomClientsState(roomId: string) {
  const clients = [...getRoomClients(roomId).entries()].map(([clientId, entry]) => ({
    clientId,
    deviceName: entry.deviceName,
    userId: entry.userId,
    userName: entry.userName,
    clientType: entry.clientType,
  }));
  const payload: RoomClientsState = {
    type: 'ROOM_CLIENTS_STATE',
    roomId,
    clients,
    timestamp: Date.now(),
  };
  getRoomClients(roomId).forEach((entry) => {
    if (entry.clientType !== 'controller') return;
    ioServers.forEach((server) => {
      server.to(entry.socketId).emit('ROOM_CLIENTS_STATE', payload);
    });
  });
}

function setControllerLock(
  roomId: string,
  clientId: string,
  socketId: string,
  deviceName?: string,
  userId?: string,
  userName?: string,
  options?: { clearPending?: boolean },
) {
  roomControllerStore.set(roomId, {
    clientId,
    socketId,
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
    deviceName,
    userId,
    userName,
  });
  if (options?.clearPending !== false) {
    pendingControlRequests.delete(roomId);
  }
  console.log(`[ws] controller lock set room=${roomId} by=${clientId}`);
  emitControllerLockState(roomId);
  emitRoomPinStateToController(roomId);
}

function appendControlAudit(
  roomId: string,
  entry: {
    action: 'request' | 'force' | 'handover' | 'deny';
    actorId: string;
    actorUserId?: string;
    actorUserName?: string;
    targetId?: string;
    timestamp: number;
    deviceName?: string;
    status?: 'accepted' | 'denied';
  },
) {
  const list = roomControlAuditStore.get(roomId) ?? [];
  list.push(entry);
  const trimmed = list.slice(-50);
  roomControlAuditStore.set(roomId, trimmed);
  scheduleRoomCacheWrite();
}

type StoredTokenPayload = {
  token: string;
  expiresAt: number;
};

type EncryptedPayload = {
  iv: string;
  authTag: string;
  data: string;
};

function parseMajorVersion(version?: string): number | null {
  if (!version) return null;
  const [majorRaw] = version.split('.');
  const major = Number(majorRaw);
  return Number.isFinite(major) ? major : null;
}

async function getMachineId(): Promise<string> {
  try {
    return await machineId();
  } catch (error) {
    console.warn('[auth] Failed to read machine id, falling back to hostname');
    return os.hostname();
  }
}

function generateJwt(secretOverride?: string): { token: string; secret: string; expiresAt: number } {
  const secret = secretOverride ?? crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = jwt.sign(
    { sub: 'companion', exp: Math.floor(expiresAt / 1000) },
    secret,
  );
  return { token, secret, expiresAt };
}

async function saveTokenToKeychain(token: string, expiresAt: number): Promise<void> {
  try {
    const keytarModule = await import('keytar');
    const keytar = (keytarModule as any).default ?? keytarModule;
    if (typeof keytar.setPassword !== 'function') {
      throw new Error('keytar.setPassword unavailable');
    }
    await keytar.setPassword(TOKEN_SERVICE, TOKEN_ACCOUNT, JSON.stringify({ token, expiresAt }));
  } catch (error) {
    throw error;
  }
}

function getFallbackTokenPath(): string {
  const base =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OnTime')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'OnTime')
        : path.join(os.homedir(), '.config', 'ontime');
  return path.join(base, 'tokens.enc');
}

function getCacheBaseDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OnTime', 'cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'OnTime', 'cache');
  }
  return path.join(os.homedir(), '.config', 'ontime', 'cache');
}

function getCachePath(): string {
  return path.join(getCacheBaseDir(), 'rooms.json');
}

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function getLocalhostCertPaths() {
  const base = path.join(getCacheBaseDir(), 'ssl');
  return {
    certPath: path.join(base, 'localhost-cert.pem'),
    keyPath: path.join(base, 'localhost-key.pem'),
    trustFlagPath: path.join(base, 'trust-shown.txt'),
    trustInstalledFlagPath: path.join(base, 'trust-installed.txt'),
    trustSkipFlagPath: path.join(base, 'trust-skip.txt'),
  };
}

async function generateLocalhostCert(): Promise<{ key: string; cert: string }> {
  try {
    const mod = await import('selfsigned');
    const selfsigned = (mod as any).default ?? mod;
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, {
      days: 825, // within Chrome's 825-day cap
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' }, // DNS
            { type: 7, ip: '127.0.0.1' }, // IPv4
            { type: 7, ip: '::1' } // IPv6
          ]
        }
      ]
    });
    return { key: pems.private, cert: pems.cert };
  } catch (error) {
    console.warn('[tls] selfsigned unavailable, using bundled localhost certificate');
    return { key: BUNDLED_LOCALHOST_KEY, cert: BUNDLED_LOCALHOST_CERT };
  }
}

function isCertExpiring(certPem: string, minMsRemaining = 30 * 24 * 60 * 60 * 1000): boolean {
  try {
    const cert = new crypto.X509Certificate(certPem);
    const expiresAt = new Date(cert.validTo).getTime();
    return Number.isNaN(expiresAt) || expiresAt - Date.now() < minMsRemaining;
  } catch {
    return true;
  }
}

async function loadOrCreateLocalhostCert(): Promise<{ key: string; cert: string }> {
  const { certPath, keyPath } = getLocalhostCertPaths();
  try {
    const [cert, key] = await Promise.all([fs.readFile(certPath, 'utf8'), fs.readFile(keyPath, 'utf8')]);
    if (cert && key && !isCertExpiring(cert)) {
      return { cert, key };
    }
  } catch {
    // fall through to generate
  }
  const next = await generateLocalhostCert();
  await ensureDir(certPath);
  await ensureDir(keyPath);
  await Promise.all([fs.writeFile(certPath, next.cert, 'utf8'), fs.writeFile(keyPath, next.key, 'utf8')]);
  console.log('[tls] Generated new localhost certificate for Companion HTTPS');
  return next;
}

async function installTrustIfNeeded(certPath: string): Promise<boolean> {
  const { trustInstalledFlagPath, trustSkipFlagPath } = getLocalhostCertPaths();
  try {
    await fs.access(trustSkipFlagPath);
    return false; // user skipped OS trust
  } catch {
    // continue
  }
  try {
    await fs.access(trustInstalledFlagPath);
    return true; // already trusted
  } catch {
    // continue
  }

  const platform = process.platform;
  const args: string[] = [];
  let cmd = '';

  if (platform === 'darwin') {
    cmd = 'security';
    args.push('add-trusted-cert', '-d', '-r', 'trustRoot', '-k', `${process.env.HOME ?? os.homedir()}/Library/Keychains/login.keychain-db`, certPath);
  } else if (platform === 'win32') {
    cmd = 'certutil';
    args.push('-addstore', '-f', 'Root', certPath);
  } else {
    return false; // skip auto-trust on other platforms
  }

  return await new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('exit', async (code) => {
      if (code === 0) {
        try {
          await ensureDir(trustInstalledFlagPath);
          await fs.writeFile(trustInstalledFlagPath, `trusted at ${new Date().toISOString()} for ${certPath}`, 'utf8');
        } catch {
          // ignore flag errors
        }
        resolve(true);
      } else {
        resolve(false);
      }
    });
    proc.on('error', () => resolve(false));
  });
}

async function installSystemTrust(certPath: string): Promise<boolean> {
  const { trustInstalledFlagPath, trustSkipFlagPath } = getLocalhostCertPaths();
  const platform = process.platform;
  const args: string[] = [];
  let cmd = '';

  if (platform === 'darwin') {
    cmd = 'sudo';
    args.push('security', 'add-trusted-cert', '-d', '-r', 'trustRoot', '-k', '/Library/Keychains/System.keychain', certPath);
  } else if (platform === 'win32') {
    cmd = 'certutil';
    args.push('-addstore', '-f', 'Root', certPath);
  } else {
    return false;
  }

  return await new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('exit', async (code) => {
      if (code === 0) {
        try {
          await ensureDir(trustInstalledFlagPath);
          await fs.writeFile(trustInstalledFlagPath, `trusted-system at ${new Date().toISOString()} for ${certPath}`, 'utf8');
        } catch {
          // ignore
        }
        resolve(true);
      } else {
        try {
          await ensureDir(trustSkipFlagPath);
          await fs.writeFile(trustSkipFlagPath, `system trust failed at ${new Date().toISOString()} for ${certPath}`, 'utf8');
        } catch {
          // ignore
        }
        resolve(false);
      }
    });
    proc.on('error', async () => {
      try {
        await ensureDir(trustSkipFlagPath);
        await fs.writeFile(trustSkipFlagPath, `system trust error at ${new Date().toISOString()} for ${certPath}`, 'utf8');
      } catch {
        // ignore
      }
      resolve(false);
    });
  });
}

async function maybePromptTrust(_certPath: string) {
  console.log('[tls] Opening HTTPS token page so you can trust the Companion localhost certificate once.');
  console.log('      If a browser warns about the certificate, expand "Advanced" and proceed to https://localhost:4441.');
  try {
    await openTrustPages('https://localhost:4441/api/token');
  } catch (error) {
    console.warn('[tls] Failed to open trust URL automatically. Please visit https://localhost:4441/api/token in your browser and accept the warning once.', error);
  }
}

function hasFile(pathToCheck: string): Promise<boolean> {
  return fs
    .access(pathToCheck)
    .then(() => true)
    .catch(() => false);
}

async function openTrustPages(url: string) {
  // Always open in default browser
  await shell.openExternal(url);

  // Best-effort: also open in common Chromium browsers so they get a chance to cache the exception
  if (process.platform === 'darwin') {
    const chromiumApps = ['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge'];
    chromiumApps.forEach((app) => {
      const child = spawn('open', ['-a', app, url], { stdio: 'ignore' });
      child.on('error', () => {
        // ignore missing apps
      });
    });
  }
}

async function maybeHandleTrust(certPath: string): Promise<void> {
  const { trustSkipFlagPath, trustInstalledFlagPath } = getLocalhostCertPaths();

  const alreadyTrusted = await hasFile(trustInstalledFlagPath);
  if (alreadyTrusted) return;


  const skipped = await hasFile(trustSkipFlagPath);
  if (skipped) return;

  const result = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Allow (Recommended)', 'Open Trust Page', 'Advanced: System Trust (Admin)', 'Skip'],
    defaultId: 0,
    cancelId: 3,
    title: 'Allow Companion Local Connection',
    message: 'Trust Companion to talk to your browser over localhost (secure, stays on your machine).',
    detail:
      'We need a local-only certificate so the browser can securely reach Companion at https://localhost.\n' +
      'This never leaves your machine. Choose:\n' +
      '• Allow (Recommended): Approve once in your browser.\n' +
      '• Open Trust Page: Same as Allow, opens the page to approve once.\n' +
      '• Advanced: System Trust (Admin): Add certificate to system trust (admin prompt).\n' +
      '• Skip: I’ll handle trust later.',
  });

  if (result.response === 0) {
    const trusted = await installTrustIfNeeded(certPath);
    if (!trusted) {
      await maybePromptTrust(certPath);
    }
  } else if (result.response === 1) {
    await maybePromptTrust(certPath);
  } else if (result.response === 2) {
    const osTrusted = await installSystemTrust(certPath);
    if (!osTrusted) {
      await maybePromptTrust(certPath);
    }
  } else {
    try {
      await ensureDir(trustSkipFlagPath);
      await fs.writeFile(trustSkipFlagPath, `skipped at ${new Date().toISOString()} for ${certPath}`, 'utf8');
    } catch {
      // ignore
    }
  }
}

async function deriveKey(): Promise<Buffer> {
  const salt = await getMachineId();
  return await new Promise((resolve, reject) => {
    crypto.pbkdf2(APP_LABEL, salt, 100_000, 32, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

async function encryptToken(data: StoredTokenPayload): Promise<EncryptedPayload> {
  const key = await deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  };
}

async function saveTokenToFileFallback(token: string, expiresAt: number): Promise<void> {
  const filePath = getFallbackTokenPath();
  await ensureDir(filePath);
  const payload = await encryptToken({ token, expiresAt });
  await fs.writeFile(filePath, JSON.stringify(payload), 'utf8');
  console.warn('[auth] Using file-based token storage (less secure than keychain)');
}

async function persistToken(token: string, expiresAt: number) {
  try {
    await saveTokenToKeychain(token, expiresAt);
  } catch (error) {
    console.warn('[auth] keytar unavailable, falling back to encrypted file storage', error);
    await saveTokenToFileFallback(token, expiresAt);
  }
}

function isLoopback(remoteAddress?: string | null): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function parseAllowedOrigins(): string[] {
  const envOrigins = process.env.COMPANION_ALLOWED_ORIGINS;
  if (!envOrigins) return DEFAULT_ALLOWED_ORIGINS;
  return envOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function validateOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // allow CLI tools like curl without Origin
  try {
    const parsed = new URL(origin);
    const protocolOk = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const hostname = parsed.hostname;
    if (protocolOk && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
      return true;
    }
  } catch {
    return false;
  }
  const normalized = normalizeOrigin(origin);
  return matchesAllowedOrigin(normalized, allowedOrigins);
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function matchesAllowedOrigin(normalizedOrigin: string | null, allowedOrigins: string[]): boolean {
  if (!normalizedOrigin) return false;
  return allowedOrigins.some((allowed) => {
    if (!allowed) return false;
    if (!allowed.includes('*')) {
      return normalizedOrigin === allowed;
    }
    // Convert wildcard entries like https://stagetime-*.web.app to a regex
    const pattern = allowed
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex chars
      .replace(/\\\*/g, '[^.]+'); // wildcard only spans a single label
    const re = new RegExp(`^${pattern}$`);
    return re.test(normalizedOrigin);
  });
}

function createTray(token: string, expiresAt: number) {
  const icon = nativeImage.createFromBuffer(getTrayPng());
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip(`${APP_LABEL} - ${MODE_LABEL}`);
  if (process.platform === 'darwin') {
    tray.setTitle('OnTime'); // helps visibility in macOS menu bar
  }

  const expiryDate = new Date(expiresAt).toLocaleString();
  const contextMenu = Menu.buildFromTemplate([
    { label: `${APP_LABEL} - ${MODE_LABEL}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Copy token',
      click: () => {
        clipboard.writeText(token);
      }
    },
    { label: `Expires: ${expiryDate}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
}

function getTrayPng(): Buffer {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVklEQVR42mNgGAWjgBDsB8RnYEAC/wMTA/4zIGnA/0EMAAWTAbEDkwHZAajB+B+LBDbABsA2QmQG0IFdCcQEqMM6FgP6AgEgKcFFABuKEgADGIDcH5V0p/AAAAAElFTkSuQmCC';
  return Buffer.from(base64, 'base64');
}

async function bootstrap() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    // No window to focus yet, placeholder for future UI.
  });

  app.on('window-all-closed', () => {
    // Keep tray running even if a future window is closed.
  });

  app.on('activate', () => {
    // Placeholder for future windows.
  });

  await app.whenReady();

  await loadRoomCache();

  const envSecret = process.env.COMPANION_JWT_SECRET || undefined;
  const { token, secret, expiresAt } = generateJwt(envSecret);
  currentToken = token;
  currentTokenExpiresAt = expiresAt;
  jwtSecret = secret;
  console.log(`[auth] Generated Companion token (expires ${new Date(expiresAt).toISOString()})`);
  try {
    await persistToken(token, expiresAt);
  } catch (error) {
    console.warn('[auth] Failed to persist token', error);
  }

  const tls = await loadOrCreateLocalhostCert();
  const { certPath } = getLocalhostCertPaths();
  await maybeHandleTrust(certPath);

  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  createTray(token, expiresAt);
  startSocketServer();
  startSecureSocketServer(tls);
  startTokenServer(token, expiresAt);
  startSecureTokenServer(token, expiresAt, tls);
}

bootstrap().catch((error) => {
  console.error('Failed to launch Companion:', error);
  app.quit();
});

function attachEngineCors(sio: SocketIOServer) {
  // Allow secure contexts to call into the loopback server (Chrome PNA preflight)
  sio.engine.on('initial_headers', (headers, req) => {
    const allowedOrigins = parseAllowedOrigins();
    const origin = req.headers?.origin as string | undefined;
    const remoteAddress = req.socket?.remoteAddress;
    if (!isLoopback(remoteAddress)) return;
    if (!validateOrigin(origin, allowedOrigins)) return;
    headers['Access-Control-Allow-Origin'] = origin ?? allowedOrigins[0];
    headers['Access-Control-Allow-Private-Network'] = 'true';
    headers['Vary'] = 'Origin';
  });
  sio.engine.on('headers', (headers, req) => {
    const allowedOrigins = parseAllowedOrigins();
    const origin = req.headers?.origin as string | undefined;
    const remoteAddress = req.socket?.remoteAddress;
    if (!isLoopback(remoteAddress)) return;
    if (!validateOrigin(origin, allowedOrigins)) return;
    headers['Access-Control-Allow-Origin'] = origin ?? allowedOrigins[0];
    headers['Access-Control-Allow-Private-Network'] = 'true';
    headers['Vary'] = 'Origin';
  });
}

function registerSocketHandlers(server: SocketIOServer) {
  server.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('JOIN_ROOM', (payload) => handleJoinRoom(socket, payload));
    socket.on('SYNC_ROOM_STATE', (payload) => handleSyncRoomState(socket, payload));
    socket.on('ROOM_STATE_PATCH', (payload) => handleRoomStatePatch(socket, payload));
    socket.on('TIMER_ACTION', (payload) => handleTimerAction(socket, payload));
    socket.on('CREATE_TIMER', (payload) => handleCreateTimer(socket, payload));
    socket.on('UPDATE_TIMER', (payload) => handleUpdateTimer(socket, payload));
    socket.on('DELETE_TIMER', (payload) => handleDeleteTimer(socket, payload));
    socket.on('REORDER_TIMERS', (payload) => handleReorderTimers(socket, payload));
    socket.on('HEARTBEAT', (payload) => handleHeartbeat(socket, payload));
    socket.on('REQUEST_CONTROL', (payload) => handleRequestControl(socket, payload));
    socket.on('FORCE_TAKEOVER', (payload) => handleForceTakeover(socket, payload));
    socket.on('HAND_OVER', (payload) => handleHandOver(socket, payload));
    socket.on('DENY_CONTROL', (payload) => handleDenyControl(socket, payload));
    socket.on('SET_ROOM_PIN', (payload) => handleSetRoomPin(socket, payload));
    socket.on('disconnect', (reason) => {
      console.log(`[ws] client disconnected: ${socket.id} (${reason})`);
      const roomId = socket.data?.roomId as string | undefined;
      const clientType = socket.data?.clientType as string | undefined;
      const clientId = socket.data?.clientId as string | undefined;
      if (clientId) {
        const pending = pendingHandshakeStore.get(clientId);
        if (pending?.socketId === socket.id) {
          pendingHandshakeStore.delete(clientId);
        }
      }
      if (roomId && clientId) {
        const clients = roomId ? getRoomClients(roomId) : null;
        clients?.delete(clientId);
        emitRoomClientsState(roomId);
      }
    });

    socket.conn.on('error', (err) => {
      console.warn(`[ws] transport error for socket=${socket.id}: ${err}`);
    });
  });
}

function createSocketServer(server: HttpServer | HttpsServer): SocketIOServer {
  const sio = new SocketIOServer(server, {
    serveClient: false,
    cors: {
      origin: true, // Allow any origin that is in the allowed list or requested
      methods: ['GET', 'POST'],
      credentials: true
    }
  });
  attachEngineCors(sio);
  registerSocketHandlers(sio);
  return sio;
}

function startSocketServer() {
  httpServer = createServer();
  io = createSocketServer(httpServer);
  ioServers.push(io);

  httpServer.listen(4000, () => {
    console.log('[ws] Companion listening on ws://localhost:4000');
  });

  app.on('before-quit', () => {
    ioServers.forEach((server) => server.close());
    httpServer?.close();
    httpsServer?.close();
    tokenServerV4?.close();
    tokenServerV6?.close();
    tokenServerTlsV4?.close();
    tokenServerTlsV6?.close();
    void flushRoomCache();
  });
}

function startSecureSocketServer(tls: { key: string; cert: string }) {
  httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert });
  ioSecure = createSocketServer(httpsServer);
  ioServers.push(ioSecure);

  httpsServer.listen(4440, '127.0.0.1', () => {
    console.log('[wss] Companion listening on wss://localhost:4440');
    console.log('[wss] If the browser blocks self-signed certs, open https://localhost:4441 once and accept the warning.');
  });
}

function enforceControllerAccess(socket: Socket, roomId: string): boolean {
  const clientType = socket.data?.clientType as 'controller' | 'viewer' | undefined;
  if (clientType !== 'controller') {
    socket.emit('ERROR', {
      type: 'ERROR',
      code: 'PERMISSION_DENIED',
      message: 'Only the controller can perform this action.',
    });
    return false;
  }
  const clientId = socket.data?.clientId as string | undefined;
  if (!clientId) {
    socket.emit('ERROR', {
      type: 'ERROR',
      code: 'INVALID_PAYLOAD',
      message: 'Missing client id.',
    });
    return false;
  }
  const current = roomControllerStore.get(roomId);
  if (!current) {
    const deviceName = typeof socket.data?.deviceName === 'string' ? socket.data.deviceName : undefined;
    const userId = typeof socket.data?.userId === 'string' ? socket.data.userId : undefined;
    const userName = typeof socket.data?.userName === 'string' ? socket.data.userName : undefined;
    setControllerLock(roomId, clientId, socket.id, deviceName, userId, userName);
    return true;
  }
  if (current.clientId !== clientId) {
    emitError(socket, 'PERMISSION_DENIED', 'Room controller is active on another device.', roomId);
    return false;
  }
  if (current.socketId !== socket.id) {
    setControllerLock(
      roomId,
      clientId,
      socket.id,
      current.deviceName,
      current.userId,
      current.userName,
      { clearPending: false },
    );
  }
  return true;
}

function verifyToken(token: string | undefined): boolean {
  if (!token || !jwtSecret) return false;
  try {
    jwt.verify(token, jwtSecret);
    return true;
  } catch (error) {
    console.warn('[auth] Token verification failed', error);
    return false;
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function getRequestOrigin(req: any): string | undefined {
  const origin = req.headers?.origin;
  return typeof origin === 'string' ? origin : undefined;
}

function getClientIdFromRequest(req: any): string | undefined {
  const header = req.headers?.['x-ontime-client-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return undefined;
}

function sendJson(res: any, status: number, body: JsonValue, origin?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function sendUnauthorized(res: any, origin?: string) {
  sendJson(res, 401, { error: 'unauthorized' }, origin);
}

function sendInvalidPath(res: any, origin?: string) {
  sendJson(res, 400, { error: 'invalid_path' }, origin);
}

function sendUnsupportedType(res: any, origin?: string) {
  sendJson(res, 400, { error: 'unsupported_type' }, origin);
}

function sendOpenFailed(res: any, origin?: string) {
  sendJson(res, 500, { error: 'open_failed' }, origin);
}

function getRedactedPath(filePath: string): string {
  const base = path.basename(filePath);
  const hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  return `${base}#${hash}`;
}

async function readJsonBody(req: any, maxBytes = 1024 * 1024): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function parseBearerToken(req: any): string | null {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1]?.trim() || null;
}

function authorizeRequest(req: any): { ok: true; origin?: string; clientId?: string } | { ok: false; origin?: string } {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getRequestOrigin(req);
  const originValid = validateOrigin(origin, allowedOrigins);
  const corsOrigin = origin && originValid ? origin : undefined;

  if (!isLoopback(req.socket?.remoteAddress)) {
    return { ok: false, origin: corsOrigin };
  }

  if (!originValid) {
    return { ok: false, origin: corsOrigin };
  }

  const token = parseBearerToken(req);
  if (!token || !verifyToken(token)) {
    return { ok: false, origin: corsOrigin };
  }

  return { ok: true, origin: corsOrigin, clientId: getClientIdFromRequest(req) };
}

function authorizeCorsOnly(req: any): { ok: true; origin?: string } | { ok: false; origin?: string } {
  const allowedOrigins = parseAllowedOrigins();
  const origin = getRequestOrigin(req);
  const originValid = validateOrigin(origin, allowedOrigins);
  const corsOrigin = origin && originValid ? origin : undefined;

  if (!isLoopback(req.socket?.remoteAddress)) {
    return { ok: false, origin: corsOrigin };
  }

  if (!originValid) {
    return { ok: false, origin: corsOrigin };
  }

  return { ok: true, origin: corsOrigin };
}

function isSubPath(parentPath: string, childPath: string): boolean {
  const parent = parentPath.endsWith(path.sep) ? parentPath : `${parentPath}${path.sep}`;
  return childPath === parentPath || childPath.startsWith(parent);
}

function isBlockedSystemPath(resolvedPath: string): boolean {
  if (process.platform === 'win32') {
    const normalized = path.win32.normalize(resolvedPath).toLowerCase();
    const systemRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    const blocked = [systemRoot, 'c:\\windows', 'c:\\windows\\system32'];
    return blocked.some((root) => normalized === root || normalized.startsWith(`${root}\\`));
  }

  const normalized = path.posix.normalize(resolvedPath);
  const blocked = ['/System', '/Library', '/etc', '/Windows'];
  return blocked.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

async function validateAndResolveUserPath(inputPath: string): Promise<string | null> {
  if (!inputPath || typeof inputPath !== 'string') return null;

  const home = os.homedir();
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(home, inputPath);

  try {
    const resolved = await fs.realpath(candidate);
    const resolvedHome = await fs.realpath(home);

    if (isBlockedSystemPath(resolved)) {
      return null;
    }

    if (!isSubPath(resolvedHome, resolved)) {
      return null;
    }

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}

async function openFileInDefaultApp(resolvedPath: string): Promise<void> {
  const platform = process.platform;
  const command =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';

  const args =
    platform === 'darwin'
      ? [resolvedPath]
      : platform === 'win32'
        ? ['/c', 'start', '', resolvedPath]
        : [resolvedPath];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`open failed (code=${code})`));
    });
    child.unref();
  });
}

async function runFfprobe(resolvedPath: string): Promise<{ duration?: number; resolution?: string }> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', resolvedPath];

  if (!ffprobePath) {
    const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const candidates = [
      process.env.FFPROBE_PATH,
      process.resourcesPath ? path.join(process.resourcesPath, 'bin', exe) : null,
      path.join(__dirname, '..', 'bin', exe),
      'ffprobe',
    ].filter(Boolean) as string[];
    ffprobePath = candidates[0] ?? 'ffprobe';
    console.log(`[file] ffprobe candidate selected: ${ffprobePath}`);
  }

  return await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(ffprobePath ?? 'ffprobe', args, { shell: false });
    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', (err: any) => {
      if (err?.code === 'ENOENT') {
        reject(Object.assign(new Error('ffprobe missing'), { code: 'ENOENT' }));
        return;
      }
      reject(err);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (code=${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as any;
        const durationRaw = parsed?.format?.duration;
        const duration = typeof durationRaw === 'string' ? Number(durationRaw) : undefined;
        const videoStream = Array.isArray(parsed?.streams)
          ? parsed.streams.find((s: any) => s?.codec_type === 'video')
          : undefined;
        const width = typeof videoStream?.width === 'number' ? videoStream.width : undefined;
        const height = typeof videoStream?.height === 'number' ? videoStream.height : undefined;
        const resolution = width && height ? `${width}x${height}` : undefined;
        resolve({
          duration: typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined,
          resolution,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

function handleJoinRoom(socket: Socket, payload: unknown) {
  if (!isValidJoinRoomPayload(payload)) {
    console.warn(`[ws] Invalid JOIN_ROOM payload from socket=${socket.id}`);
    const error: HandshakeError = {
      type: 'HANDSHAKE_ERROR',
      code: 'INVALID_PAYLOAD',
      message: 'Invalid join payload.'
    };
    socket.emit('HANDSHAKE_ERROR', error);
    socket.disconnect(true);
    return;
  }

  const clientId = payload.clientId ?? socket.id;
  const pending = pendingHandshakeStore.get(clientId);
  if (pending) {
    const age = Date.now() - pending.startedAt;
    if (age < PENDING_HANDSHAKE_TTL_MS) {
      console.warn(`[ws] Duplicate pending handshake for clientId=${clientId}`);
      const error: HandshakeError = {
        type: 'HANDSHAKE_ERROR',
        code: 'INVALID_PAYLOAD',
        message: 'Handshake already pending.'
      };
      socket.emit('HANDSHAKE_ERROR', error);
      socket.disconnect(true);
      return;
    }
    pendingHandshakeStore.delete(clientId);
  }

  if (!verifyToken(payload.token)) {
    console.warn(
      `[ws] Invalid token from socket=${socket.id}, room=${payload.roomId ?? 'unknown'}`
    );
    const error: HandshakeError = {
      type: 'HANDSHAKE_ERROR',
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired token.'
    };
    socket.emit('HANDSHAKE_ERROR', error);
    socket.disconnect(true);
    return;
  }

  const clientMajor = parseMajorVersion(payload.interfaceVersion);
  const serverMajor = parseMajorVersion(INTERFACE_VERSION);
  if (clientMajor !== null && serverMajor !== null && clientMajor !== serverMajor) {
    console.warn(
      `[ws] Interface version mismatch client=${payload.interfaceVersion ?? 'unknown'} server=${INTERFACE_VERSION}`
    );
  }

  pendingHandshakeStore.set(clientId, { socketId: socket.id, startedAt: Date.now() });
  socket.data.clientId = clientId;
  socket.data.clientType = payload.clientType === 'controller' ? 'controller' : 'viewer';
  socket.data.roomId = payload.roomId;
  socket.data.deviceName = typeof payload.deviceName === 'string' && payload.deviceName.trim()
    ? payload.deviceName.trim().slice(0, 120)
    : undefined;
  socket.data.userId = typeof payload.userId === 'string' && payload.userId.trim()
    ? payload.userId.trim().slice(0, 120)
    : undefined;
  socket.data.userName = typeof payload.userName === 'string' && payload.userName.trim()
    ? payload.userName.trim().slice(0, 120)
    : undefined;
  const payloadOwnerId = typeof payload.ownerId === 'string' && payload.ownerId.trim()
    ? payload.ownerId.trim().slice(0, 120)
    : undefined;
  if (payloadOwnerId && socket.data.userId && payloadOwnerId === socket.data.userId) {
    const existingOwner = roomOwnerStore.get(payload.roomId);
    if (!existingOwner) {
      roomOwnerStore.set(payload.roomId, {
        ownerId: payloadOwnerId,
        ownerName: socket.data.userName,
        updatedAt: Date.now(),
        setBy: socket.data?.clientId ?? socket.id,
      });
      scheduleRoomCacheWrite();
    }
  }
  getRoomClients(payload.roomId).set(clientId, {
    socketId: socket.id,
    deviceName: socket.data.deviceName,
    userId: socket.data.userId,
    userName: socket.data.userName,
    clientType: socket.data.clientType,
  });

  const requestedType = socket.data.clientType as 'controller' | 'viewer';
  const currentLock = roomControllerStore.get(payload.roomId);
  const shouldClaimLock =
    requestedType === 'controller' &&
    (!currentLock || currentLock.clientId === clientId);

  const ack: HandshakeAck = {
    type: 'HANDSHAKE_ACK',
    success: true,
    companionMode: COMPANION_MODE,
    companionVersion: COMPANION_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    capabilities: {
      powerpoint: false,
      externalVideo: false,
      fileOperations: true
    },
    systemInfo: {
      platform: process.platform,
      hostname: os.hostname()
    }
  };

  console.log(
    `[ws] JOIN_ROOM accepted: room=${payload.roomId}, clientType=${payload.clientType ?? 'unknown'}, socket=${socket.id}`
  );

  socket.emit('HANDSHAKE_ACK', ack);
  socket.join(payload.roomId);

  if (shouldClaimLock) {
    const clearPending = !currentLock || currentLock.clientId !== clientId;
    setControllerLock(
      payload.roomId,
      clientId,
      socket.id,
      socket.data.deviceName,
      socket.data.userId,
      socket.data.userName,
      { clearPending },
    );
  } else {
    emitControllerLockStateToSocket(socket, payload.roomId);
  }
  emitRoomClientsState(payload.roomId);

  console.log(`[ws] sending ROOM_STATE_SNAPSHOT to socket=${socket.id}, room=${payload.roomId}`);

  const snapshot: RoomStateSnapshot = {
    type: 'ROOM_STATE_SNAPSHOT',
    roomId: payload.roomId,
    state: getRoomState(payload.roomId),
    timestamp: Date.now()
  };

  socket.emit('ROOM_STATE_SNAPSHOT', snapshot);
  pendingHandshakeStore.delete(clientId);
}

function isValidJoinRoomPayload(payload: unknown): payload is JoinRoomPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Partial<JoinRoomPayload>;
  return (
    data.type === 'JOIN_ROOM' &&
    typeof data.roomId === 'string' &&
    typeof data.token === 'string'
  );
}

function isValidHeartbeatPayload(payload: unknown): payload is HeartbeatPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<HeartbeatPayload>;
  return (
    data.type === 'HEARTBEAT' &&
    typeof data.roomId === 'string' &&
    typeof data.clientId === 'string' &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function isValidRequestControlPayload(payload: unknown): payload is RequestControlPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<RequestControlPayload>;
  return (
    data.type === 'REQUEST_CONTROL' &&
    typeof data.roomId === 'string' &&
    typeof data.clientId === 'string' &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function isValidForceTakeoverPayload(payload: unknown): payload is ForceTakeoverPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<ForceTakeoverPayload>;
  return (
    data.type === 'FORCE_TAKEOVER' &&
    typeof data.roomId === 'string' &&
    typeof data.clientId === 'string' &&
    (data.pin === undefined || typeof data.pin === 'string') &&
    (data.reauthenticated === undefined || typeof data.reauthenticated === 'boolean') &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function isValidHandOverPayload(payload: unknown): payload is HandOverPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<HandOverPayload>;
  return (
    data.type === 'HAND_OVER' &&
    typeof data.roomId === 'string' &&
    typeof data.targetClientId === 'string' &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function isValidDenyControlPayload(payload: unknown): payload is DenyControlPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<DenyControlPayload>;
  return (
    data.type === 'DENY_CONTROL' &&
    typeof data.roomId === 'string' &&
    typeof data.requesterId === 'string' &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function isValidSetRoomPinPayload(payload: unknown): payload is SetRoomPinPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<SetRoomPinPayload>;
  return (
    data.type === 'SET_ROOM_PIN' &&
    typeof data.roomId === 'string' &&
    typeof data.timestamp === 'number' &&
    Number.isFinite(data.timestamp)
  );
}

function handleHeartbeat(socket: Socket, payload: unknown) {
  if (!isValidHeartbeatPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid HEARTBEAT payload.');
    return;
  }
  const current = roomControllerStore.get(payload.roomId);
  if (!current || current.clientId !== payload.clientId) return;
  if (current.socketId !== socket.id) return;
  current.lastHeartbeat = Date.now();
}

function handleRequestControl(socket: Socket, payload: unknown) {
  if (!isValidRequestControlPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid REQUEST_CONTROL payload.');
    return;
  }
  const socketClientId = socket.data?.clientId as string | undefined;
  if (!socketClientId || socketClientId !== payload.clientId) {
    emitError(socket, 'INVALID_PAYLOAD', 'Mismatched client id.');
    return;
  }
  const requesterName = typeof payload.deviceName === 'string' && payload.deviceName.trim()
    ? payload.deviceName.trim().slice(0, 120)
    : undefined;
  const requesterUserId = typeof payload.userId === 'string' && payload.userId.trim()
    ? payload.userId.trim().slice(0, 120)
    : undefined;
  const requesterUserName = typeof payload.userName === 'string' && payload.userName.trim()
    ? payload.userName.trim().slice(0, 120)
    : undefined;
  const roomId = payload.roomId;
  const current = roomControllerStore.get(roomId);
  if (!current) {
    setControllerLock(
      roomId,
      payload.clientId,
      socket.id,
      requesterName,
      requesterUserId,
      requesterUserName,
    );
    return;
  }
  if (current.clientId === payload.clientId) return;
  pendingControlRequests.set(roomId, {
    requesterId: payload.clientId,
    requesterName,
    requesterUserId,
    requesterUserName,
    requestedAt: Date.now(),
  });
  appendControlAudit(roomId, {
    action: 'request',
    actorId: payload.clientId,
    actorUserId: requesterUserId,
    actorUserName: requesterUserName,
    timestamp: Date.now(),
    deviceName: requesterName,
  });
  const event: ControlRequestReceived = {
    type: 'CONTROL_REQUEST_RECEIVED',
    roomId,
    requesterId: payload.clientId,
    requesterName,
    requesterUserId,
    requesterUserName,
    timestamp: Date.now(),
  };
  const targetSocket = current.socketId;
  ioServers.forEach((server) => {
    server.to(targetSocket).emit('CONTROL_REQUEST_RECEIVED', event);
  });
}

function handleForceTakeover(socket: Socket, payload: unknown) {
  if (!isValidForceTakeoverPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid FORCE_TAKEOVER payload.');
    return;
  }
  const socketClientId = socket.data?.clientId as string | undefined;
  if (!socketClientId || socketClientId !== payload.clientId) {
    emitError(socket, 'INVALID_PAYLOAD', 'Mismatched client id.');
    return;
  }
  const roomId = payload.roomId;
  const current = roomControllerStore.get(roomId);
  if (!current) {
    setControllerLock(
      roomId,
      payload.clientId,
      socket.id,
      socket.data?.deviceName,
      socket.data?.userId,
      socket.data?.userName,
    );
    return;
  }
  if (current.clientId === payload.clientId) return;
  const pending = pendingControlRequests.get(roomId);
  const now = Date.now();
  const requestAgeMs = pending ? now - pending.requestedAt : 0;
  const allowByTimeout = pending?.requesterId === payload.clientId && requestAgeMs >= CONTROL_REQUEST_TIMEOUT_MS;
  const normalizedPin = normalizeRoomPin(payload.pin);
  const storedPin = roomPinStore.get(roomId)?.pin ?? null;
  const allowByPin = Boolean(storedPin && normalizedPin && normalizedPin === storedPin);
  const allowByReauth = payload.reauthenticated === true;
  if (!allowByTimeout && !allowByPin && !allowByReauth) {
    appendControlAudit(roomId, {
      action: 'force',
      actorId: payload.clientId,
      actorUserId: socket.data?.userId,
      actorUserName: socket.data?.userName,
      timestamp: now,
      deviceName: socket.data?.deviceName,
      status: 'denied',
    });
    emitError(socket, 'PERMISSION_DENIED', 'Force takeover requires a valid room PIN, re-auth, or timeout.', roomId);
    return;
  }
  setControllerLock(
    roomId,
    payload.clientId,
    socket.id,
    socket.data?.deviceName,
    socket.data?.userId,
    socket.data?.userName,
  );
  appendControlAudit(roomId, {
    action: 'force',
    actorId: payload.clientId,
    actorUserId: socket.data?.userId,
    actorUserName: socket.data?.userName,
    timestamp: now,
    deviceName: socket.data?.deviceName,
    status: 'accepted',
  });
}

function handleHandOver(socket: Socket, payload: unknown) {
  if (!isValidHandOverPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid HAND_OVER payload.');
    return;
  }
  const roomId = payload.roomId;
  if (!enforceControllerAccess(socket, roomId)) {
    return;
  }
  const targetClientId = payload.targetClientId;
  const clients = getRoomClients(roomId);
  const target = clients.get(targetClientId);
  if (!target) {
    emitError(socket, 'NOT_FOUND', 'Target controller not connected.');
    return;
  }
  if (target.clientType !== 'controller') {
    emitError(socket, 'PERMISSION_DENIED', 'Target must be a controller.', roomId);
    return;
  }
  setControllerLock(
    roomId,
    targetClientId,
    target.socketId,
    target.deviceName,
    target.userId,
    target.userName,
  );
  appendControlAudit(roomId, {
    action: 'handover',
    actorId: socket.data?.clientId ?? socket.id,
    actorUserId: socket.data?.userId,
    actorUserName: socket.data?.userName,
    targetId: targetClientId,
    timestamp: Date.now(),
    deviceName: target.deviceName,
  });
}

function handleDenyControl(socket: Socket, payload: unknown) {
  if (!isValidDenyControlPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid DENY_CONTROL payload.');
    return;
  }
  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }
  const roomId = payload.roomId;
  const pending = pendingControlRequests.get(roomId);
  if (!pending || pending.requesterId !== payload.requesterId) return;
  pendingControlRequests.delete(roomId);
  appendControlAudit(roomId, {
    action: 'deny',
    actorId: socket.data?.clientId ?? socket.id,
    actorUserId: socket.data?.userId,
    actorUserName: socket.data?.userName,
    targetId: payload.requesterId,
    timestamp: Date.now(),
    status: 'denied',
  });
  const clients = getRoomClients(roomId);
  const target = clients.get(payload.requesterId);
  if (!target) return;
  const event: ControlRequestDenied = {
    type: 'CONTROL_REQUEST_DENIED',
    roomId,
    requesterId: payload.requesterId,
    timestamp: Date.now(),
    reason: 'denied_by_controller',
    deniedByName: socket.data?.deviceName,
    deniedByUserId: socket.data?.userId,
    deniedByUserName: socket.data?.userName,
  };
  ioServers.forEach((server) => {
    server.to(target.socketId).emit('CONTROL_REQUEST_DENIED', event);
  });
}

function handleSetRoomPin(socket: Socket, payload: unknown) {
  if (!isValidSetRoomPinPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid SET_ROOM_PIN payload.');
    return;
  }
  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }
  const owner = roomOwnerStore.get(payload.roomId);
  const requesterUserId = socket.data?.userId;
  if (owner) {
    if (!requesterUserId || requesterUserId !== owner.ownerId) {
      emitError(socket, 'PERMISSION_DENIED', 'Only the room owner can set the PIN.', payload.roomId);
      return;
    }
  } else {
    if (!requesterUserId) {
      emitError(socket, 'PERMISSION_DENIED', 'Sign in to set the room PIN.', payload.roomId);
      return;
    }
    roomOwnerStore.set(payload.roomId, {
      ownerId: requesterUserId,
      ownerName: socket.data?.userName,
      updatedAt: Date.now(),
      setBy: socket.data?.clientId ?? socket.id,
    });
    scheduleRoomCacheWrite();
  }
  const rawPin = typeof payload.pin === 'string' ? payload.pin : null;
  const normalized = normalizeRoomPin(rawPin ?? null);
  if (rawPin && !normalized) {
    emitError(socket, 'INVALID_PAYLOAD', 'PIN must be 4-8 digits.', payload.roomId);
    return;
  }
  if (!normalized) {
    roomPinStore.delete(payload.roomId);
  } else {
    roomPinStore.set(payload.roomId, {
      pin: normalized,
      updatedAt: Date.now(),
      setBy: socket.data?.clientId ?? socket.id,
      setByUserId: socket.data?.userId,
      setByUserName: socket.data?.userName,
    });
  }
  scheduleRoomCacheWrite();
  emitRoomPinStateToController(payload.roomId);
}

function isValidSyncRoomStatePayload(payload: unknown): payload is SyncRoomStatePayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<SyncRoomStatePayload>;
  if (data.type !== 'SYNC_ROOM_STATE') return false;
  if (typeof data.roomId !== 'string') return false;
  if (!data.state || typeof data.state !== 'object') return false;
  const state = data.state as Partial<RoomState>;
  const activeOk = state.activeTimerId === null || typeof state.activeTimerId === 'string';
  const runningOk = typeof state.isRunning === 'boolean';
  const currentTimeOk = typeof state.currentTime === 'number' && Number.isFinite(state.currentTime);
  const lastUpdateOk = typeof state.lastUpdate === 'number' && Number.isFinite(state.lastUpdate) && state.lastUpdate > 0;
  if (!activeOk || !runningOk || !currentTimeOk || !lastUpdateOk) return false;
  if (data.timers !== undefined && !Array.isArray(data.timers)) return false;
  if (Array.isArray(data.timers)) {
    const ok = data.timers.every((t) => {
      if (!t || typeof t !== 'object') return false;
      const timer = t as Partial<Timer>;
      const typeOk = timer.type === 'countdown' || timer.type === 'countup' || timer.type === 'timeofday';
      return (
        typeof timer.id === 'string' &&
        typeof timer.roomId === 'string' &&
        typeof timer.title === 'string' &&
        typeof timer.duration === 'number' &&
        Number.isFinite(timer.duration) &&
        timer.duration > 0 &&
        typeof timer.order === 'number' &&
        Number.isFinite(timer.order) &&
        typeOk
      );
    });
    if (!ok) return false;
  }
  return true;
}

function isValidRoomStatePatchPayload(payload: unknown): payload is RoomStatePatchPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<RoomStatePatchPayload>;
  if (data.type !== 'ROOM_STATE_PATCH') return false;
  if (typeof data.roomId !== 'string') return false;
  if (!data.changes || typeof data.changes !== 'object') return false;

  const changes = data.changes as Partial<RoomState>;
  const allowedKeys = new Set(['activeTimerId', 'isRunning', 'currentTime', 'lastUpdate']);
  const keys = Object.keys(changes);
  if (!keys.every((key) => allowedKeys.has(key))) return false;

  if (changes.activeTimerId !== undefined && changes.activeTimerId !== null && typeof changes.activeTimerId !== 'string') {
    return false;
  }
  if (changes.isRunning !== undefined && typeof changes.isRunning !== 'boolean') return false;
  if (changes.currentTime !== undefined) {
    if (typeof changes.currentTime !== 'number' || !Number.isFinite(changes.currentTime)) return false;
  }
  if (changes.lastUpdate !== undefined) {
    if (typeof changes.lastUpdate !== 'number' || !Number.isFinite(changes.lastUpdate)) return false;
  }
  return true;
}

function emitError(socket: Socket, code: string, message: string, roomId?: string) {
  socket.emit('ERROR', { type: 'ERROR', code, message, roomId });
}

function handleSyncRoomState(socket: Socket, payload: unknown) {
  if (!isValidSyncRoomStatePayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid SYNC_ROOM_STATE payload.');
    return;
  }

  // Must have joined as controller; JOIN_ROOM is where token is validated.
  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  if (!socket.rooms.has(payload.roomId)) {
    socket.join(payload.roomId);
  }

  const roomId = payload.roomId;
  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.sourceClientId;

  // 1) Apply timers if provided
  if (Array.isArray(payload.timers)) {
    const map = getRoomTimers(roomId);
    const existingIds = new Set([...map.keys()]);
    const nextIds = new Set(payload.timers.map((t) => t.id));

    // Emit deletions for timers removed by the snapshot.
    existingIds.forEach((id) => {
      if (!nextIds.has(id)) {
        const deleted: TimerDeleted = {
          type: 'TIMER_DELETED',
          roomId,
          timerId: id,
          // Intentionally omit clientId so all clients apply it (including the controller that sent SYNC).
          timestamp: now,
        };
        emitToRoom(roomId, 'TIMER_DELETED', deleted);
      }
    });

    // Treat payload.timers as a full snapshot: replace existing timers for deterministic convergence.
    map.clear();
    payload.timers.forEach((timer) => {
      map.set(timer.id, { ...timer, roomId });
      const created: TimerCreated = {
        type: 'TIMER_CREATED',
        roomId,
        timer: { ...timer, roomId },
        // Intentionally omit clientId so the sender also applies it.
        timestamp: now,
      };
      emitToRoom(roomId, 'TIMER_CREATED', created);
    });
    normalizeTimerOrder(roomId);

    // Emit a single reorder event (clients will re-render sorted list); for now we do not emit per-timer created/updated.
    const reordered: TimersReordered = {
      type: 'TIMERS_REORDERED',
      roomId,
      timerIds: listRoomTimers(roomId).map((t) => t.id),
      clientId,
      timestamp: now,
    };
    emitToRoom(roomId, 'TIMERS_REORDERED', reordered);
  }

  // 2) Apply state snapshot
  const nextState: RoomState = {
    activeTimerId: payload.state.activeTimerId ?? null,
    isRunning: payload.state.isRunning,
    currentTime: payload.state.currentTime,
    lastUpdate: payload.state.lastUpdate,
  };
  roomStateStore.set(roomId, nextState);
  scheduleRoomCacheWrite();

  const delta: RoomStateDelta = {
    type: 'ROOM_STATE_DELTA',
    roomId,
    changes: nextState,
    clientId,
    timestamp: now,
  };
  emitToRoom(roomId, 'ROOM_STATE_DELTA', delta);

  // Also ack with a fresh snapshot to the sender (optional but helpful).
  const snapshot: RoomStateSnapshot = {
    type: 'ROOM_STATE_SNAPSHOT',
    roomId,
    state: nextState,
    timestamp: now,
  };
  socket.emit('ROOM_STATE_SNAPSHOT', snapshot);

  console.log(`[ws] SYNC_ROOM_STATE room=${roomId} by=${clientId ?? socket.id} timers=${payload.timers?.length ?? 0}`);
}

function handleRoomStatePatch(socket: Socket, payload: unknown) {
  if (!isValidRoomStatePatchPayload(payload)) {
    emitError(socket, 'INVALID_PAYLOAD', 'Invalid ROOM_STATE_PATCH payload.');
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  if (!socket.rooms.has(payload.roomId)) {
    socket.join(payload.roomId);
  }

  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.clientId;
  const roomId = payload.roomId;
  const state = getRoomState(roomId);
  const changes = { ...payload.changes };

  // Allow negative currentTime for bonus time; only validate finiteness.
  if (process.env.NODE_ENV === 'development') {
    const progress = state.progress ?? {};
    const activeId = state.activeTimerId;
    const activeProgress = activeId ? progress[activeId] : undefined;
    console.info('[companion] ROOM_STATE_PATCH in', {
      roomId,
      activeId,
      currentTimeIncoming: changes.currentTime,
      currentTimeExisting: state.currentTime,
      elapsedOffset: state.elapsedOffset,
      lastUpdateIncoming: changes.lastUpdate,
      lastUpdateExisting: state.lastUpdate,
      progressActive: activeProgress,
    });
  }
  if (changes.lastUpdate === undefined) {
    changes.lastUpdate = now;
  }

  const nextState: RoomState = { ...state, ...changes };
  roomStateStore.set(roomId, nextState);
  scheduleRoomCacheWrite();

  const delta: RoomStateDelta = {
    type: 'ROOM_STATE_DELTA',
    roomId,
    changes,
    clientId,
    timestamp: now
  };

  emitToRoom(roomId, 'ROOM_STATE_DELTA', delta);
  console.log(`[ws] ROOM_STATE_PATCH room=${roomId} by=${clientId ?? socket.id}`);
}

function handleTimerAction(socket: Socket, payload: unknown) {
  if (!isValidTimerActionPayload(payload)) {
    console.warn(`[ws] Invalid TIMER_ACTION payload from socket=${socket.id}`);
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  if (!socket.rooms.has(payload.roomId)) {
    console.warn(`[ws] TIMER_ACTION: socket=${socket.id} not in room=${payload.roomId}, auto-joining`);
    socket.join(payload.roomId);
  }

  const now = Date.now();
  const state = getRoomState(payload.roomId);
  let changes: Partial<RoomState> = {};
  const baseCurrent = Number.isFinite(state.currentTime) ? (state.currentTime as number) : 0;

  switch (payload.action) {
    case 'START': {
      // Use provided currentTime if available (for stored progress when switching timers).
      // Otherwise, if resuming the same timer, preserve the elapsed time.
      // If switching without provided currentTime, reset to 0.
      const isSwitchingTimer = payload.timerId !== state.activeTimerId;
      const startTime = typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)
        ? payload.currentTime
        : (isSwitchingTimer ? 0 : baseCurrent);
      changes = {
        activeTimerId: payload.timerId,
        isRunning: true,
        currentTime: startTime,
        lastUpdate: payload.timestamp ?? now
      };
      break;
    }
    case 'PAUSE':
      // Persist the computed elapsed time so switching modes (Cloud↔Local) while paused does not "reset" the timer.
      // We can compute elapsed using the last running anchor (lastUpdate) and the stored base (currentTime).
      // Note: state.currentTime is treated as elapsed-at-lastUpdate.
      const pauseNow = payload.timestamp ?? now;
      const elapsedSinceLast =
        state.isRunning && typeof state.lastUpdate === 'number'
          ? Math.max(0, pauseNow - state.lastUpdate)
          : 0;
      const nextCurrentTime = baseCurrent + elapsedSinceLast;
      changes = {
        isRunning: false,
        currentTime: nextCurrentTime,
        lastUpdate: pauseNow
      };
      break;
    case 'RESET':
      changes = {
        activeTimerId: payload.timerId,
        isRunning: false,
        currentTime: 0,
        lastUpdate: payload.timestamp ?? now
      };
      break;
    default:
      return;
  }

  const updated = { ...state, ...changes };
  roomStateStore.set(payload.roomId, updated);
  scheduleRoomCacheWrite();

  const delta: RoomStateDelta = {
    type: 'ROOM_STATE_DELTA',
    roomId: payload.roomId,
    changes,
    clientId: socket.data.clientId ?? payload.clientId,
    timestamp: payload.timestamp ?? now
  };

  console.log(
    `[ws] TIMER_ACTION ${payload.action}: room=${payload.roomId}, timer=${payload.timerId}, socket=${socket.id}, changes=${JSON.stringify(
      changes
    )}`
  );

  emitToRoom(payload.roomId, 'ROOM_STATE_DELTA', delta);
  console.log(
    `[ws] broadcast ROOM_STATE_DELTA to room=${payload.roomId}: ${JSON.stringify(delta.changes)}`
  );
}

const TIMER_TITLE_MAX_LEN = 120;
const ALLOWED_TIMER_PATCH_KEYS = new Set(['title', 'duration', 'speaker', 'type']);

function getRoomTimers(roomId: string): Map<string, Timer> {
  if (roomTimersStore.has(roomId)) return roomTimersStore.get(roomId)!;
  const map = new Map<string, Timer>();
  roomTimersStore.set(roomId, map);
  scheduleRoomCacheWrite();
  return map;
}

function listRoomTimers(roomId: string): Timer[] {
  return [...getRoomTimers(roomId).values()].sort((a, b) => a.order - b.order);
}

function normalizeTimerTitle(title: string): string {
  return title.trim().slice(0, TIMER_TITLE_MAX_LEN);
}

function normalizeTimerType(input: unknown): TimerType {
  if (input === 'countup' || input === 'timeofday') return input;
  return 'countdown';
}

function normalizeTimerOrder(roomId: string, orderedTimerIds?: string[]) {
  const existing = listRoomTimers(roomId);
  const existingIds = new Set(existing.map((timer) => timer.id));

  const explicit: string[] = [];
  if (orderedTimerIds) {
    orderedTimerIds.forEach((id) => {
      if (existingIds.has(id)) explicit.push(id);
    });
  }

  // Keep FIFO for unknowns (timers not included in the reorder payload).
  const remainder = existing.map((timer) => timer.id).filter((id) => !explicit.includes(id));
  const finalOrder = [...explicit, ...remainder];

  finalOrder.forEach((id, index) => {
    const timer = getRoomTimers(roomId).get(id);
    if (timer) {
      timer.order = (index + 1) * 10;
    }
  });
  scheduleRoomCacheWrite();
  return finalOrder;
}

function emitTimerError(socket: Socket, roomId: string, code: TimerError['code'], message: string, clientId?: string) {
  const payload: TimerError = {
    type: 'TIMER_ERROR',
    roomId,
    code,
    message,
    clientId,
    timestamp: Date.now(),
  };
  socket.emit('TIMER_ERROR', payload);
}

function isValidCreateTimerPayload(payload: unknown): payload is CreateTimerPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<CreateTimerPayload>;
  return data.type === 'CREATE_TIMER' && typeof data.roomId === 'string' && !!data.timer && typeof data.timer === 'object';
}

function isValidUpdateTimerPayload(payload: unknown): payload is UpdateTimerPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<UpdateTimerPayload>;
  return data.type === 'UPDATE_TIMER' && typeof data.roomId === 'string' && typeof data.timerId === 'string' && !!data.changes && typeof data.changes === 'object';
}

function isValidDeleteTimerPayload(payload: unknown): payload is DeleteTimerPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<DeleteTimerPayload>;
  return data.type === 'DELETE_TIMER' && typeof data.roomId === 'string' && typeof data.timerId === 'string';
}

function isValidReorderTimersPayload(payload: unknown): payload is ReorderTimersPayload {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as Partial<ReorderTimersPayload>;
  return (
    data.type === 'REORDER_TIMERS' &&
    typeof data.roomId === 'string' &&
    Array.isArray(data.timerIds) &&
    data.timerIds.every((id) => typeof id === 'string')
  );
}

function handleCreateTimer(socket: Socket, payload: unknown) {
  if (!isValidCreateTimerPayload(payload)) {
    emitTimerError(socket, 'unknown', 'INVALID_PAYLOAD', 'Invalid CREATE_TIMER payload.', socket.data.clientId);
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.clientId;
  const roomId = payload.roomId;

  const title = typeof payload.timer.title === 'string' ? normalizeTimerTitle(payload.timer.title) : '';
  const duration = typeof payload.timer.duration === 'number' ? payload.timer.duration : NaN;
  if (!title || !Number.isFinite(duration) || duration <= 0) {
    emitTimerError(socket, roomId, 'INVALID_FIELDS', 'Timer requires non-empty title and duration > 0.', clientId);
    return;
  }

  const timerId = typeof payload.timer.id === 'string' && payload.timer.id.trim()
    ? payload.timer.id.trim()
    : crypto.randomUUID();
  const speaker = typeof payload.timer.speaker === 'string' ? payload.timer.speaker.trim().slice(0, 120) : '';
  const type = normalizeTimerType(payload.timer.type);

  const existing = listRoomTimers(roomId);
  const nextOrder = existing.length ? Math.max(...existing.map((t) => t.order)) + 10 : 10;
  const order = typeof payload.timer.order === 'number' && Number.isFinite(payload.timer.order) ? payload.timer.order : nextOrder;

  const timer: Timer = {
    id: timerId,
    roomId,
    title,
    duration,
    speaker,
    type,
    order,
  };

  const timers = getRoomTimers(roomId);
  if (timers.has(timerId)) {
    emitTimerError(socket, roomId, 'INVALID_FIELDS', 'Timer id already exists.', clientId);
    return;
  }

  timers.set(timerId, timer);
  normalizeTimerOrder(roomId);

  const event: TimerCreated = {
    type: 'TIMER_CREATED',
    roomId,
    timer,
    clientId,
    timestamp: now,
  };

  if (!socket.rooms.has(roomId)) {
    socket.join(roomId);
  }

  emitToRoom(roomId, 'TIMER_CREATED', event);
  console.log(`[ws] TIMER_CREATED room=${roomId} timer=${timerId} by=${clientId ?? socket.id}`);
}

function handleUpdateTimer(socket: Socket, payload: unknown) {
  if (!isValidUpdateTimerPayload(payload)) {
    emitTimerError(socket, 'unknown', 'INVALID_PAYLOAD', 'Invalid UPDATE_TIMER payload.', socket.data.clientId);
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.clientId;
  const roomId = payload.roomId;
  const timerId = payload.timerId;

  const timers = getRoomTimers(roomId);
  const timer = timers.get(timerId);
  if (!timer) {
    emitTimerError(socket, roomId, 'NOT_FOUND', 'Timer not found.', clientId);
    return;
  }

  const keys = Object.keys(payload.changes as Record<string, unknown>);
  const invalidKey = keys.find((key) => !ALLOWED_TIMER_PATCH_KEYS.has(key));
  if (invalidKey) {
    emitTimerError(socket, roomId, 'INVALID_FIELDS', `Unsupported change key: ${invalidKey}`, clientId);
    return;
  }

  const changes: Partial<Timer> = {};
  if (typeof payload.changes.title === 'string') {
    const nextTitle = normalizeTimerTitle(payload.changes.title);
    if (!nextTitle) {
      emitTimerError(socket, roomId, 'INVALID_FIELDS', 'Title cannot be empty.', clientId);
      return;
    }
    changes.title = nextTitle;
  }
  if (typeof payload.changes.speaker === 'string') {
    changes.speaker = payload.changes.speaker.trim().slice(0, 120);
  }
  if (payload.changes.duration !== undefined) {
    const nextDuration = payload.changes.duration;
    if (typeof nextDuration !== 'number' || !Number.isFinite(nextDuration) || nextDuration <= 0) {
      emitTimerError(socket, roomId, 'INVALID_FIELDS', 'Duration must be a number > 0.', clientId);
      return;
    }
    changes.duration = nextDuration;
  }
  if (payload.changes.type !== undefined) {
    changes.type = normalizeTimerType(payload.changes.type);
  }

  timers.set(timerId, { ...timer, ...changes });
  scheduleRoomCacheWrite();

  const event: TimerUpdated = {
    type: 'TIMER_UPDATED',
    roomId,
    timerId,
    changes,
    clientId,
    timestamp: now,
  };

  if (!socket.rooms.has(roomId)) {
    socket.join(roomId);
  }

  emitToRoom(roomId, 'TIMER_UPDATED', event);
  console.log(`[ws] TIMER_UPDATED room=${roomId} timer=${timerId} by=${clientId ?? socket.id}`);
}

function handleDeleteTimer(socket: Socket, payload: unknown) {
  if (!isValidDeleteTimerPayload(payload)) {
    emitTimerError(socket, 'unknown', 'INVALID_PAYLOAD', 'Invalid DELETE_TIMER payload.', socket.data.clientId);
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.clientId;
  const roomId = payload.roomId;
  const timerId = payload.timerId;

  const timers = getRoomTimers(roomId);
  if (!timers.has(timerId)) {
    emitTimerError(socket, roomId, 'NOT_FOUND', 'Timer not found.', clientId);
    return;
  }

  timers.delete(timerId);
  const finalOrder = normalizeTimerOrder(roomId);

  const deleted: TimerDeleted = {
    type: 'TIMER_DELETED',
    roomId,
    timerId,
    clientId,
    timestamp: now,
  };
  emitToRoom(roomId, 'TIMER_DELETED', deleted);

  const reordered: TimersReordered = {
    type: 'TIMERS_REORDERED',
    roomId,
    timerIds: finalOrder,
    clientId,
    timestamp: now,
  };
  emitToRoom(roomId, 'TIMERS_REORDERED', reordered);

  scheduleRoomCacheWrite();
  console.log(`[ws] TIMER_DELETED room=${roomId} timer=${timerId} by=${clientId ?? socket.id}`);
}

function handleReorderTimers(socket: Socket, payload: unknown) {
  if (!isValidReorderTimersPayload(payload)) {
    emitTimerError(socket, 'unknown', 'INVALID_PAYLOAD', 'Invalid REORDER_TIMERS payload.', socket.data.clientId);
    return;
  }

  if (!enforceControllerAccess(socket, payload.roomId)) {
    return;
  }

  const now = payload.timestamp ?? Date.now();
  const clientId = socket.data.clientId ?? payload.clientId;
  const roomId = payload.roomId;

  const finalOrder = normalizeTimerOrder(roomId, payload.timerIds);
  const event: TimersReordered = {
    type: 'TIMERS_REORDERED',
    roomId,
    timerIds: finalOrder,
    clientId,
    timestamp: now,
  };

  if (!socket.rooms.has(roomId)) {
    socket.join(roomId);
  }

  emitToRoom(roomId, 'TIMERS_REORDERED', event);
  console.log(`[ws] TIMERS_REORDERED room=${roomId} by=${clientId ?? socket.id} count=${finalOrder.length}`);
}

function isValidTimerActionPayload(payload: unknown): payload is TimerActionPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const data = payload as Partial<TimerActionPayload>;
  const validAction = data.action === 'START' || data.action === 'PAUSE' || data.action === 'RESET';
  return data.type === 'TIMER_ACTION' && typeof data.roomId === 'string' && typeof data.timerId === 'string' && validAction;
}

function getRoomState(roomId: string): RoomState {
  if (roomStateStore.has(roomId)) {
    return roomStateStore.get(roomId)!;
  }

  const initial: RoomState = {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: Date.now()
  };

  roomStateStore.set(roomId, initial);
  scheduleRoomCacheWrite();
  return initial;
}

function createTokenHandler(token: string, expiresAt: number) {
  return (req: any, res: any) => {
    const allowedOrigins = parseAllowedOrigins();
    const origin = req.headers.origin as string | undefined;
    const remoteAddress = req.socket?.remoteAddress;

    if (typeof req.url === 'string') {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/api/token') {
        if (!isLoopback(remoteAddress)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }

        if (!validateOrigin(origin, allowedOrigins)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid origin' }));
          return;
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OnTime-Client-Id',
            'Access-Control-Allow-Private-Network': 'true'
          });
          res.end();
          return;
        }

        if (req.method === 'GET') {
          const returnTo = url.searchParams.get('return');
          const isHttp = (value: string) => value.startsWith('http://') || value.startsWith('https://');
          const safeReturn = returnTo && isHttp(returnTo) ? returnTo : null;
          if (safeReturn) {
            const escapeAttr = (value: string) => value.replace(/"/g, '&quot;');
            const redirectTarget = JSON.stringify(safeReturn);
            const escapedAttr = escapeAttr(safeReturn);
            const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Companion Trust</title>
  <meta http-equiv="refresh" content="0;url=${escapedAttr}">
</head>
<body style="font-family:system-ui;background:#0b1220;color:#e5e7eb;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 12px;">Local Companion trusted</h1>
  <p style="margin:0 0 8px;">We fetched your Companion token on this device.</p>
  <pre style="white-space:pre-wrap;background:#0f172a;border:1px solid #1e293b;padding:12px;border-radius:8px;">${JSON.stringify({ token, expiresAt }, null, 2)}</pre>
  <p style="margin:12px 0 16px;">Redirecting you back to the app… If it doesn’t move, <a href="${escapedAttr}" style="color:#a5b4fc;">click here</a>.</p>
  <script>
    const target = ${redirectTarget};
    function go() {
      try { window.location.replace(target); } catch (err) { window.location.href = target; }
    }
    setTimeout(go, 60);
    setTimeout(() => { try { window.close(); } catch (err) {} }, 1600);
  </script>
</body>
</html>`;
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
              'Access-Control-Allow-Private-Network': 'true'
            });
            res.end(html);
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Private-Network': 'true'
          });
          res.end(JSON.stringify({ token, expiresAt }));
          return;
        }
      }

      if (url.pathname === '/api/open' && req.method === 'OPTIONS') {
        const cors = authorizeCorsOnly(req);
        if (!cors.ok) {
          sendUnauthorized(res);
          return;
        }
        res.writeHead(204, {
          'Access-Control-Allow-Origin': cors.origin ?? allowedOrigins[0],
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OnTime-Client-Id',
          Vary: 'Origin',
        });
        res.end();
        return;
      }

      if (url.pathname === '/api/open' && req.method === 'POST') {
        const auth = authorizeRequest(req);
        if (!auth.ok) {
          sendUnauthorized(res, auth.origin);
          return;
        }

        void (async () => {
          let data: unknown;
          try {
            data = await readJsonBody(req);
          } catch {
            sendInvalidPath(res, auth.origin);
            return;
          }
          try {
            const inputPath = (data as any)?.path;
            if (typeof inputPath !== 'string') {
              sendInvalidPath(res, auth.origin);
              return;
            }

            const resolved = await validateAndResolveUserPath(inputPath);
            if (!resolved) {
              sendInvalidPath(res, auth.origin);
              console.warn(
                `[file] open denied caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(inputPath)}`
              );
              return;
            }

            await openFileInDefaultApp(resolved);
            sendJson(res, 200, { success: true }, auth.origin);
            console.log(
              `[file] open ok caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(resolved)}`
            );
          } catch (error) {
            console.warn(
              `[file] open failed caller=${auth.clientId ?? 'unknown'} error=${String(error)}`
            );
            sendOpenFailed(res, auth.origin);
          }
        })();
        return;
      }

      if (url.pathname === '/api/file/metadata' && req.method === 'OPTIONS') {
        const cors = authorizeCorsOnly(req);
        if (!cors.ok) {
          sendUnauthorized(res);
          return;
        }
        res.writeHead(204, {
          'Access-Control-Allow-Origin': cors.origin ?? allowedOrigins[0],
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OnTime-Client-Id',
          Vary: 'Origin',
        });
        res.end();
        return;
      }

      if (url.pathname === '/api/file/metadata' && req.method === 'GET') {
        const auth = authorizeRequest(req);
        if (!auth.ok) {
          sendUnauthorized(res, auth.origin);
          return;
        }

        const inputPath = url.searchParams.get('path');
        if (!inputPath) {
          sendInvalidPath(res, auth.origin);
          return;
        }

        const extension = path.extname(inputPath).toLowerCase().replace('.', '');
        const allowedExtensions = new Set(['mp4', 'mov', 'avi', 'mkv']);
        if (!allowedExtensions.has(extension)) {
          sendUnsupportedType(res, auth.origin);
          return;
        }

        void (async () => {
          try {
            const resolved = await validateAndResolveUserPath(inputPath);
            if (!resolved) {
              sendInvalidPath(res, auth.origin);
              console.warn(
                `[file] metadata denied caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(inputPath)}`
              );
              return;
            }

            const stat = await fs.stat(resolved);
            try {
              const { duration, resolution } = await runFfprobe(resolved);
              const payload: Record<string, JsonValue> = {
                size: stat.size,
              };
              if (typeof duration === 'number') {
                payload.duration = duration;
              }
              if (typeof resolution === 'string') {
                payload.resolution = resolution;
              }
              sendJson(
                res,
                200,
                payload,
                auth.origin
              );
              console.log(
                `[file] metadata ok caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(resolved)}`
              );
            } catch (error: any) {
              if (error?.code === 'ENOENT') {
                if (!ffprobeMissingWarned) {
                  ffprobeMissingWarned = true;
                  console.warn('[file] ffprobe missing; metadata will be limited to size only');
                }
                sendJson(
                  res,
                  200,
                  {
                    warning: 'ffprobe missing',
                    size: stat.size,
                  },
                  auth.origin
                );
                return;
              }

              console.warn(
                `[file] metadata failed caller=${auth.clientId ?? 'unknown'} error=${String(error)}`
              );
              sendOpenFailed(res, auth.origin);
            }
          } catch (error) {
            console.warn(
              `[file] metadata failed caller=${auth.clientId ?? 'unknown'} error=${String(error)}`
            );
            sendOpenFailed(res, auth.origin);
          }
        })();
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}

function startTokenServer(token: string, expiresAt: number) {
  const handler = createTokenHandler(token, expiresAt);

  tokenServerV4 = createServer(handler);
  tokenServerV6 = createServer(handler);

  tokenServerV4.listen(4001, '127.0.0.1', () => {
    console.log('[http] Token endpoint listening on http://127.0.0.1:4001/api/token');
  });

  tokenServerV6.listen({ port: 4001, host: '::1', ipv6Only: true }, () => {
    console.log('[http] Token endpoint listening on http://[::1]:4001/api/token');
  });
}

function startSecureTokenServer(token: string, expiresAt: number, tls: { key: string; cert: string }) {
  const handler = createTokenHandler(token, expiresAt);
  tokenServerTlsV4 = createHttpsServer({ key: tls.key, cert: tls.cert }, handler);
  tokenServerTlsV6 = createHttpsServer({ key: tls.key, cert: tls.cert }, handler);

  tokenServerTlsV4.listen(4441, '127.0.0.1', () => {
    console.log('[https] Token endpoint listening on https://127.0.0.1:4441/api/token');
  });

  tokenServerTlsV6.listen({ port: 4441, host: '::1', ipv6Only: true }, () => {
    console.log('[https] Token endpoint listening on https://[::1]:4441/api/token');
  });
}

async function loadRoomCache() {
  const cachePath = getCachePath();
  try {
    const data = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(data) as {
      version: number;
      lastWrite?: number;
      rooms?: Record<string, RoomState>;
      timers?: Record<string, Timer[]>;
      controlAudit?: Record<string, Array<{
        action: 'request' | 'force' | 'handover' | 'deny';
        actorId: string;
        actorUserId?: string;
        actorUserName?: string;
        targetId?: string;
        timestamp: number;
        deviceName?: string;
        status?: 'accepted' | 'denied';
      }>>;
      pins?: Record<string, {
        pin: string;
        updatedAt: number;
        setBy?: string;
        setByUserId?: string;
        setByUserName?: string;
      }>;
      owners?: Record<string, {
        ownerId: string;
        ownerName?: string;
        updatedAt: number;
        setBy?: string;
      }>;
    };
    if (parsed.version !== CACHE_VERSION || !parsed.rooms) {
      console.warn('[cache] Cache version mismatch or missing rooms; starting fresh');
      return;
    }
    Object.entries(parsed.rooms).forEach(([roomId, state]) => {
      roomStateStore.set(roomId, state);
    });
    if (parsed.timers) {
      Object.entries(parsed.timers).forEach(([roomId, timers]) => {
        const map = new Map<string, Timer>();
        (timers ?? []).forEach((timer) => {
          if (timer && typeof timer.id === 'string') {
            map.set(timer.id, timer);
          }
        });
        if (map.size) {
          roomTimersStore.set(roomId, map);
        }
      });
    }
    if (parsed.controlAudit) {
      Object.entries(parsed.controlAudit).forEach(([roomId, entries]) => {
        if (Array.isArray(entries)) {
          roomControlAuditStore.set(roomId, entries.slice(-50));
        }
      });
    }
    if (parsed.pins) {
      Object.entries(parsed.pins).forEach(([roomId, entry]) => {
        if (entry && typeof entry.pin === 'string') {
          roomPinStore.set(roomId, {
            pin: entry.pin,
            updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
            setBy: entry.setBy,
            setByUserId: entry.setByUserId,
            setByUserName: entry.setByUserName,
          });
        }
      });
    }
    if (parsed.owners) {
      Object.entries(parsed.owners).forEach(([roomId, entry]) => {
        if (entry && typeof entry.ownerId === 'string') {
          roomOwnerStore.set(roomId, {
            ownerId: entry.ownerId,
            ownerName: entry.ownerName,
            updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
            setBy: entry.setBy,
          });
        }
      });
    }
    lastWriteTs = parsed.lastWrite ?? Date.now();
    console.log(`[cache] Loaded ${roomStateStore.size} rooms from cache`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log('[cache] No existing cache, starting fresh');
      return;
    }
    console.error('[cache] Failed to load cache, attempting backup', error);
    await backupCorruptedCache(cachePath);
  }
}

async function backupCorruptedCache(cachePath: string) {
  try {
    const cacheDir = path.dirname(cachePath);
    await fs.mkdir(cacheDir, { recursive: true });
    const timestamp = Date.now();
    const backupPath = path.join(cacheDir, `rooms.json.backup.${timestamp}`);
    await fs.copyFile(cachePath, backupPath);
    console.warn(`[cache] Backed up corrupted cache to ${backupPath}`);
    await trimBackups(cacheDir);
  } catch (err) {
    console.error('[cache] Failed to backup corrupted cache', err);
  }
}

async function trimBackups(cacheDir: string) {
  try {
    const files = await fs.readdir(cacheDir);
    const backups = files
      .filter((f) => f.startsWith('rooms.json.backup.'))
      .map((f) => ({ file: f, ts: parseInt(f.split('.').pop() || '0', 10) }))
      .sort((a, b) => b.ts - a.ts);
    if (backups.length <= 3) return;
    const toDelete = backups.slice(3);
    await Promise.all(
      toDelete.map(({ file }) => fs.unlink(path.join(cacheDir, file)).catch((err) => console.warn('[cache] Failed to delete old backup', err)))
    );
  } catch (err) {
    console.warn('[cache] Failed to trim backups', err);
  }
}

function scheduleRoomCacheWrite() {
  if (cacheWriteTimer) {
    clearTimeout(cacheWriteTimer);
  }
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null;
    void writeRoomCache();
  }, CACHE_WRITE_DEBOUNCE_MS);
}

async function flushRoomCache() {
  if (cacheWriteTimer) {
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer = null;
    await writeRoomCache();
  }
}

async function writeRoomCache() {
  try {
    const cachePath = getCachePath();
    const cacheDir = path.dirname(cachePath);
    await fs.mkdir(cacheDir, { recursive: true });
    const payload = {
      version: CACHE_VERSION,
      lastWrite: Date.now(),
      rooms: Object.fromEntries(roomStateStore.entries()),
      timers: Object.fromEntries(
        [...roomTimersStore.entries()].map(([roomId, timerMap]) => [
          roomId,
          [...timerMap.values()].sort((a, b) => a.order - b.order),
        ])
      ),
      controlAudit: Object.fromEntries(roomControlAuditStore.entries()),
      pins: Object.fromEntries(roomPinStore.entries()),
      owners: Object.fromEntries(roomOwnerStore.entries()),
    };
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    lastWriteTs = payload.lastWrite;
    console.log(`[cache] Wrote cache with ${roomStateStore.size} rooms`);
  } catch (error) {
    console.error('[cache] Failed to write cache', error);
  }
}
