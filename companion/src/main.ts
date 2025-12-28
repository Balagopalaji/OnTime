import { app, Menu, Tray, nativeImage, clipboard } from 'electron';
import { createServer, Server as HttpServer } from 'node:http';
import { spawn } from 'node:child_process';
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
  takeOver?: boolean;
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
let httpServer: HttpServer | null = null;
let tokenServerV4: HttpServer | null = null;
let tokenServerV6: HttpServer | null = null;
const roomStateStore: Map<string, RoomState> = new Map();
const roomTimersStore: Map<string, Map<string, Timer>> = new Map();
const roomControllerStore: Map<string, { clientId: string; socketId: string; connectedAt: number }> = new Map();
let currentToken: string | null = null;
let currentTokenExpiresAt: number | null = null;
let jwtSecret: string | null = null;
let cacheWriteTimer: NodeJS.Timeout | null = null;
let lastWriteTs = 0;
let ffprobeMissingWarned = false;
let ffprobePath: string | null = null;

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
    cors: { 
      origin: true, // Allow any origin that is in the allowed list or requested
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('JOIN_ROOM', (payload) => handleJoinRoom(socket, payload));
    socket.on('SYNC_ROOM_STATE', (payload) => handleSyncRoomState(socket, payload));
    socket.on('ROOM_STATE_PATCH', (payload) => handleRoomStatePatch(socket, payload));
    socket.on('TIMER_ACTION', (payload) => handleTimerAction(socket, payload));
    socket.on('CREATE_TIMER', (payload) => handleCreateTimer(socket, payload));
    socket.on('UPDATE_TIMER', (payload) => handleUpdateTimer(socket, payload));
    socket.on('DELETE_TIMER', (payload) => handleDeleteTimer(socket, payload));
    socket.on('REORDER_TIMERS', (payload) => handleReorderTimers(socket, payload));
    socket.on('disconnect', (reason) => {
      console.log(`[ws] client disconnected: ${socket.id} (${reason})`);
      const roomId = socket.data?.roomId as string | undefined;
      const clientType = socket.data?.clientType as string | undefined;
      const clientId = socket.data?.clientId as string | undefined;
      if (roomId && clientType === 'controller' && clientId) {
        const current = roomControllerStore.get(roomId);
        if (current?.clientId === clientId) {
          roomControllerStore.delete(roomId);
          console.log(`[ws] controller released room=${roomId} by=${clientId}`);
        }
      }
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

function isActiveController(roomId: string, clientId: string | undefined): boolean {
  if (!clientId) return false;
  const current = roomControllerStore.get(roomId);
  if (!current) return true; // no controller lock yet; allow first controller to act
  return current.clientId === clientId;
}

function enforceControllerAccess(socket: Socket, roomId: string): boolean {
  // Multi-controller: allow all controllers; viewers are still blocked at call sites where needed.
  const clientType = socket.data?.clientType as 'controller' | 'viewer' | undefined;
  if (clientType !== 'controller') {
    socket.emit('ERROR', {
      type: 'ERROR',
      code: 'PERMISSION_DENIED',
      message: 'Only the controller can perform this action.',
    });
    return false;
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
  socket.data.clientType = payload.clientType === 'controller' ? 'controller' : 'viewer';
  socket.data.roomId = payload.roomId;

  const requestedType = socket.data.clientType as 'controller' | 'viewer';
  if (requestedType === 'controller') {
    // Multi-controller allowed: track latest controller but do not reject others.
    roomControllerStore.set(payload.roomId, { clientId, socketId: socket.id, connectedAt: Date.now() });
  }

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

function emitError(socket: Socket, code: string, message: string) {
  socket.emit('ERROR', { type: 'ERROR', code, message });
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
        io?.to(roomId).emit('TIMER_DELETED', deleted);
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
      io?.to(roomId).emit('TIMER_CREATED', created);
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
    io?.to(roomId).emit('TIMERS_REORDERED', reordered);
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
  io?.to(roomId).emit('ROOM_STATE_DELTA', delta);

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

  io?.to(roomId).emit('ROOM_STATE_DELTA', delta);
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

  io?.to(payload.roomId).emit('ROOM_STATE_DELTA', delta);
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

  io?.to(roomId).emit('TIMER_CREATED', event);
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

  io?.to(roomId).emit('TIMER_UPDATED', event);
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
  io?.to(roomId).emit('TIMER_DELETED', deleted);

  const reordered: TimersReordered = {
    type: 'TIMERS_REORDERED',
    roomId,
    timerIds: finalOrder,
    clientId,
    timestamp: now,
  };
  io?.to(roomId).emit('TIMERS_REORDERED', reordered);

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

  io?.to(roomId).emit('TIMERS_REORDERED', event);
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

function startTokenServer(token: string, expiresAt: number) {
  const handler = (req: any, res: any) => {
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
    const parsed = JSON.parse(data) as {
      version: number;
      lastWrite?: number;
      rooms?: Record<string, RoomState>;
      timers?: Record<string, Timer[]>;
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
    };
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
    lastWriteTs = payload.lastWrite;
    console.log(`[cache] Wrote cache with ${roomStateStore.size} rooms`);
  } catch (error) {
    console.error('[cache] Failed to write cache', error);
  }
}
