import { app, Menu, Tray, nativeImage, clipboard } from 'electron';
import { createServer, Server as HttpServer } from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { machineId } from 'node-machine-id';

let tray: Tray | null = null;

const APP_LABEL = 'OnTime Companion';
const MODE_LABEL = 'Minimal Mode';
const COMPANION_MODE = 'minimal';
const COMPANION_VERSION = '0.1.0';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_SERVICE = 'OnTime Companion Token';
const TOKEN_ACCOUNT = 'default';
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://[::1]:5173',
  'http://[::1]:3000'
];
const CACHE_VERSION = 2;
const CACHE_WRITE_DEBOUNCE_MS = 2000;

type JoinRoomPayload = {
  type: 'JOIN_ROOM';
  roomId: string;
  token: string;
  clientType?: 'controller' | 'viewer';
  clientId?: string;
};

type HandshakeAck = {
  type: 'HANDSHAKE_ACK';
  success: true;
  companionMode: typeof COMPANION_MODE;
  companionVersion: string;
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
  code: 'INVALID_TOKEN' | 'INVALID_PAYLOAD';
  message: string;
};

type RoomState = {
  activeTimerId: string | null;
  isRunning: boolean;
  currentTime: number;
  lastUpdate: number;
};

type TimerActionPayload = {
  type: 'TIMER_ACTION';
  action: 'START' | 'PAUSE' | 'RESET';
  roomId: string;
  timerId: string;
  timestamp?: number;
  clientId?: string;
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

let io: SocketIOServer | null = null;
let httpServer: HttpServer | null = null;
let tokenServerV4: HttpServer | null = null;
let tokenServerV6: HttpServer | null = null;
const roomStateStore: Map<string, RoomState> = new Map();
let currentToken: string | null = null;
let currentTokenExpiresAt: number | null = null;
let jwtSecret: string | null = null;
let cacheWriteTimer: NodeJS.Timeout | null = null;
let lastWriteTs = 0;

type StoredTokenPayload = {
  token: string;
  expiresAt: number;
};

type EncryptedPayload = {
  iv: string;
  authTag: string;
  data: string;
};

async function getMachineId(): Promise<string> {
  try {
    return await machineId();
  } catch (error) {
    console.warn('[auth] Failed to read machine id, falling back to hostname');
    return os.hostname();
  }
}

function generateJwt(): { token: string; expiresAt: number; secret: string } {
  const secret = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const token = jwt.sign(
    {
      scope: 'companion',
      exp: Math.floor(expiresAt / 1000),
    },
    secret
  );
  return { token, expiresAt, secret };
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
    const url = new URL(origin);
    return allowedOrigins.includes(`${url.protocol}//${url.host}`);
  } catch {
    return false;
  }
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

  const { token, expiresAt, secret } = generateJwt();
  currentToken = token;
  currentTokenExpiresAt = expiresAt;
  jwtSecret = secret;
  console.log(`[auth] Generated Companion token (expires ${new Date(expiresAt).toISOString()})`);
  try {
    await persistToken(token, expiresAt);
  } catch (error) {
    console.warn('[auth] Failed to persist token', error);
  }

  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  createTray(token, expiresAt);
  startSocketServer();
  startTokenServer(token, expiresAt);
}

bootstrap().catch((error) => {
  console.error('Failed to launch Companion:', error);
  app.quit();
});

function startSocketServer() {
  httpServer = createServer();
  io = new SocketIOServer(httpServer, {
    serveClient: false,
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('JOIN_ROOM', (payload) => handleJoinRoom(socket, payload));
    socket.on('TIMER_ACTION', (payload) => handleTimerAction(socket, payload));
    socket.on('disconnect', (reason) => {
      console.log(`[ws] client disconnected: ${socket.id} (${reason})`);
    });

    socket.conn.on('error', (err) => {
      console.warn(`[ws] transport error for socket=${socket.id}: ${err}`);
    });
  });

  httpServer.listen(4000, () => {
    console.log('[ws] Companion listening on ws://localhost:4000');
  });

  app.on('before-quit', () => {
    io?.close();
    httpServer?.close();
    tokenServerV4?.close();
    tokenServerV6?.close();
    void flushRoomCache();
  });
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

  const clientId = payload.clientId ?? socket.id;
  socket.data.clientId = clientId;

  const ack: HandshakeAck = {
    type: 'HANDSHAKE_ACK',
    success: true,
    companionMode: COMPANION_MODE,
    companionVersion: COMPANION_VERSION,
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

  console.log(`[ws] sending ROOM_STATE_SNAPSHOT to socket=${socket.id}, room=${payload.roomId}`);

  const snapshot: RoomStateSnapshot = {
    type: 'ROOM_STATE_SNAPSHOT',
    roomId: payload.roomId,
    state: getRoomState(payload.roomId),
    timestamp: Date.now()
  };

  socket.emit('ROOM_STATE_SNAPSHOT', snapshot);
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

function handleTimerAction(socket: Socket, payload: unknown) {
  if (!isValidTimerActionPayload(payload)) {
    console.warn(`[ws] Invalid TIMER_ACTION payload from socket=${socket.id}`);
    return;
  }

  if (!socket.rooms.has(payload.roomId)) {
    console.warn(`[ws] TIMER_ACTION: socket=${socket.id} not in room=${payload.roomId}, auto-joining`);
    socket.join(payload.roomId);
  }

  const now = Date.now();
  const state = getRoomState(payload.roomId);
  let changes: Partial<RoomState> = {};

  switch (payload.action) {
    case 'START':
      changes = {
        activeTimerId: payload.timerId,
        isRunning: true,
        lastUpdate: payload.timestamp ?? now
      };
      break;
    case 'PAUSE':
      changes = {
        isRunning: false,
        lastUpdate: payload.timestamp ?? now
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

  io?.to(payload.roomId).emit('ROOM_STATE_DELTA', delta);
  console.log(
    `[ws] broadcast ROOM_STATE_DELTA to room=${payload.roomId}: ${JSON.stringify(delta.changes)}`
  );
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

function startTokenServer(token: string, expiresAt: number) {
  const handler = (req: any, res: any) => {
    const allowedOrigins = parseAllowedOrigins();
    const origin = req.headers.origin as string | undefined;
    const remoteAddress = req.socket?.remoteAddress;

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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.url === '/api/token' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
      });
      res.end(JSON.stringify({ token, expiresAt }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };

  tokenServerV4 = createServer(handler);
  tokenServerV6 = createServer(handler);

  tokenServerV4.listen(4001, '127.0.0.1', () => {
    console.log('[http] Token endpoint listening on http://127.0.0.1:4001/api/token');
  });

  tokenServerV6.listen({ port: 4001, host: '::1', ipv6Only: true }, () => {
    console.log('[http] Token endpoint listening on http://[::1]:4001/api/token');
  });
}

async function loadRoomCache() {
  const cachePath = getCachePath();
  try {
    const data = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(data) as { version: number; lastWrite?: number; rooms?: Record<string, RoomState> };
    if (parsed.version !== CACHE_VERSION || !parsed.rooms) {
      console.warn('[cache] Cache version mismatch or missing rooms; starting fresh');
      return;
    }
    Object.entries(parsed.rooms).forEach(([roomId, state]) => {
      roomStateStore.set(roomId, state);
    });
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
    };
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    lastWriteTs = payload.lastWrite;
    console.log(`[cache] Wrote cache with ${roomStateStore.size} rooms`);
  } catch (error) {
    console.error('[cache] Failed to write cache', error);
  }
}
