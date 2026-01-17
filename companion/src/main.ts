import { app, Menu, Tray, nativeImage, clipboard, shell, dialog, BrowserWindow, systemPreferences } from 'electron';
import { createServer, Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer, Server as HttpsServer } from 'node:https';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readline from 'node:readline';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { machineId } from 'node-machine-id';
import selfsigned from 'selfsigned';

let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;
let statusWindow: BrowserWindow | null = null;

type CompanionMode = 'minimal' | 'show_control' | 'production';

const APP_LABEL = 'OnTime Companion';
let currentCompanionMode: CompanionMode = 'show_control';
const COMPANION_VERSION = '0.1.1-dev.2';
const INTERFACE_VERSION = '1.2.0';
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
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
const PPT_POLL_INTERVAL_MS = 1000;
const PPT_DEBOUNCE_MS = 600;
const PPT_VIDEO_CLEAR_POLLS = 2;
const PPT_BACKGROUND_CLEAR_MS = 10_000;
const PPT_LOG_FILENAME = 'ppt.log';
const PPT_STARTUP_LOG_FILENAME = 'ppt.startup.log';
const PPT_DEBUG_FILENAME = 'ppt.debug';
const PPT_DEBUG_VERBOSE_FILENAME = 'ppt.debug.verbose';
const PPT_DEBUG_FALLBACK_DIRS = [
  path.join(os.homedir(), 'Library', 'Application Support', 'ontime-companion'),
  path.join(os.homedir(), 'Library', 'Application Support', 'OnTime Companion'),
  path.join(os.homedir(), 'Library', 'Application Support', 'OnTime'),
];
let pptDebugDirs: string[] = [];
let pptDebugEnabled = false;
let pptDebugVerboseEnabled = false;
let pptNoVideoKey: string | null = null;
let pptNoVideoCount = 0;
let pptExplicitNoVideoKey: string | null = null;
let pptExplicitNoVideoCount = 0;
const pptVideoCache = new Map<string, VideoTiming[]>();

/**
 * PptProbeManager manages the persistent native Swift helper process.
 */
class PptProbeManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lastStatus: PowerPointProbeResult | null = null;
  private restartCount = 0;
  private lastRestartTime = 0;

  start() {
    if (process.platform !== 'darwin') return;
    this.spawn();
  }

  private spawn() {
    const exeName = 'ppt-probe-mac';
    const candidates = [
      path.join(process.resourcesPath || '', 'bin', exeName),
      path.join(app.getAppPath(), 'bin', exeName),
      path.join(__dirname, '..', 'bin', exeName)
    ].filter(Boolean);

    let helperPath = candidates.find(p => fsSync.existsSync(p));

    if (pptDebugEnabled) {
      void appendPptLog(`[ppt-probe] Searching for helper at: ${candidates.join(', ')}`);
      void appendPptLog(`[ppt-probe] Resolved path: ${helperPath || 'NOT FOUND'}`);
    }

    if (!helperPath) {
      console.warn(`[ppt-probe] Helper not found at searched locations.`);
      return;
    }

    try {
      this.child = spawn(helperPath, [], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
      logPptInfo(`[ppt-probe] Native helper spawned (pid: ${this.child.pid}) at ${helperPath}`);

      this.child.on('error', (err) => {
        logPptInfo(`[ppt-probe] Spawn error: ${err.message}`);
        this.child = null;
      });

      const rl = readline.createInterface({ input: this.child.stdout });
      rl.on('line', (line) => {
        try {
          this.lastStatus = JSON.parse(line);
          if (pptDebugVerboseEnabled) {
            logPptInfo(`[ppt-probe] Received status for pid=${this.lastStatus?.instanceId} videos=${this.lastStatus?.videos.length}`);
          }
        } catch (err) {
          logPptInfo(`[ppt-probe] JSON parse error: ${line}`);
        }
      });

      this.child.stderr.on('data', (data) => {
        logPptInfo(`[ppt-probe-stderr] ${data.toString('utf8').trim()}`);
      });

      this.child.on('exit', (code) => {
        console.warn(`[ppt-probe] Native helper exited with code ${code}`);
        logPptInfo(`[ppt-probe] Native helper exited with code ${code}`);
        this.child = null;
        this.handleRestart();
      });
    } catch (err) {
      logPptInfo(`[ppt-probe] Unexpected spawn error: ${String(err)}`);
    }
  }

  private handleRestart() {
    const now = Date.now();
    if (now - this.lastRestartTime > 60000) {
      this.restartCount = 0;
    }

    if (this.restartCount < 3) {
      this.restartCount++;
      this.lastRestartTime = now;
      console.log(`[ppt-probe] Restart attempt ${this.restartCount}/3...`);
      setTimeout(() => this.spawn(), 2000);
    } else {
      console.error('[ppt-probe] Max restart attempts reached.');
    }
  }

  getStatus(): PowerPointProbeResult | null {
    return this.lastStatus;
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  stop() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

const pptProbeManager = new PptProbeManager();
const COMPANION_CAPABILITIES_BY_MODE: Record<
  string,
  { powerpoint: boolean; externalVideo: boolean; fileOperations: boolean }
> = {
  minimal: {
    powerpoint: false,
    externalVideo: false,
    fileOperations: true
  },
  show_control: {
    powerpoint: true,
    externalVideo: false,
    fileOperations: true
  },
  production: {
    powerpoint: true,
    externalVideo: true,
    fileOperations: true
  }
};

function getCompanionCapabilities() {
  return COMPANION_CAPABILITIES_BY_MODE[currentCompanionMode] ?? {
    powerpoint: false,
    externalVideo: false,
    fileOperations: false
  };
}

function getModeLabel(mode: CompanionMode): string {
  switch (mode) {
    case 'minimal': return 'Minimal Mode';
    case 'show_control': return 'Show Control Mode';
    case 'production': return 'Production Mode';
    default: return 'Unknown Mode';
  }
}

function getConnectedClientsCount(): number {
  let count = 0;
  ioServers.forEach((server) => {
    count += server.sockets.sockets.size;
  });
  return count;
}

function resolvePptDebugDirs(): string[] {
  const dirs = [...PPT_DEBUG_FALLBACK_DIRS];
  if (app.isReady()) {
    dirs.unshift(app.getPath('userData'));
  }
  return Array.from(new Set(dirs));
}

function computePptDebugEnabled(dirs: string[]): boolean {
  if (process.env.COMPANION_DEBUG_PPT === 'true') return true;
  return dirs.some((dir) => fsSync.existsSync(path.join(dir, PPT_DEBUG_FILENAME)));
}

function computePptDebugVerboseEnabled(dirs: string[]): boolean {
  if (process.env.COMPANION_DEBUG_PPT_VERBOSE === 'true') return true;
  return dirs.some((dir) => fsSync.existsSync(path.join(dir, PPT_DEBUG_VERBOSE_FILENAME)));
}

async function initializePptDebugLogging(): Promise<void> {
  pptDebugDirs = resolvePptDebugDirs();
  pptDebugEnabled = computePptDebugEnabled(pptDebugDirs) || process.env.PPT_AX_DEBUG === "1" || process.env.PPT_HAWK_MODE === "1";
  pptDebugVerboseEnabled = process.env.PPT_AX_DEBUG === "1" || process.env.PPT_HAWK_MODE === "1" || computePptDebugVerboseEnabled(pptDebugDirs);
  if (pptDebugVerboseEnabled) {
    pptDebugEnabled = true;
  }
  if (!pptDebugEnabled) return;
  const startupLine = `[ppt] startup ${new Date().toISOString()} mode=${currentCompanionMode} userData=${app.isReady() ? app.getPath('userData') : 'n/a'}`;
  for (const dir of pptDebugDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, PPT_STARTUP_LOG_FILENAME), `${startupLine}\n`, 'utf8');
      break;
    } catch {
      // try next directory
    }
  }
}

function logPptInfo(message: string, meta?: unknown): void {
  if (!pptDebugEnabled) return;
  const line = meta === undefined ? message : `${message} ${JSON.stringify(meta)}`;
  console.info(message, meta);
  void appendPptLog(line);
}

function logPptVerbose(message: string, meta?: unknown): void {
  if (!pptDebugVerboseEnabled) return;
  const line = meta === undefined ? message : `${message} ${JSON.stringify(meta)}`;
  console.info(message, meta);
  void appendPptLog(line);
}

async function appendPptLog(line: string): Promise<void> {
  const debugEnabled =
    pptDebugEnabled || computePptDebugEnabled(pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs());
  if (!debugEnabled) return;
  const dirs = pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs();
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, PPT_LOG_FILENAME), `${line}\n`, 'utf8');
      return;
    } catch {
      // try next directory
    }
  }
}

async function writePptScript(script: string): Promise<void> {
  const debugEnabled =
    pptDebugEnabled || computePptDebugEnabled(pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs());
  if (!debugEnabled) return;
  const dirs = pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs();
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'ppt.script.applescript'), script, 'utf8');
      return;
    } catch {
      // try next directory
    }
  }
}

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
  companionMode: CompanionMode;
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
  activeLiveCueId?: string;
};

type LiveCueConfig = {
  warningSec?: number;
  criticalSec?: number;
};

type VideoTiming = {
  id?: number;
  name?: string;
  duration?: number;
  elapsed?: number;
  remaining?: number;
  playing?: boolean;
};

type VideoProbeStatus = {
  name: string;
  duration?: number;
  elapsed?: number;
  playing: boolean;
};

type PowerPointProbeResult = {
  state: 'none' | 'background' | 'foreground';
  instanceId: number;
  inSlideshow: boolean;
  slideNumber?: number;
  totalSlides?: number;
  pptPath?: string;
  videos: VideoProbeStatus[];
  error?: string;
  permissions: 'granted' | 'missing' | 'unknown';
};

type LiveCueMetadata = {
  slideNumber?: number;
  totalSlides?: number;
  slideNotes?: string;
  filename?: string;
  player?: string;
  parentTimerId?: string;
  autoAdvanceNext?: boolean;
  videoPlaying?: boolean;
  videoDuration?: number;
  videoElapsed?: number;
  videoRemaining?: number;
  videos?: VideoTiming[];
  videoTimingUnavailable?: boolean;
  instanceId?: number;
};

type LiveCue = {
  id: string;
  source: 'powerpoint' | 'external_video' | 'pdf';
  title: string;
  duration?: number;
  startedAt?: number;
  status?: 'playing' | 'paused' | 'ended';
  config?: LiveCueConfig;
  metadata?: LiveCueMetadata;
};

type LiveCueEventPayload = {
  type: 'LIVE_CUE_CREATED' | 'LIVE_CUE_UPDATED' | 'LIVE_CUE_ENDED';
  roomId: string;
  cue: LiveCue;
  timestamp: number;
};

type PresentationEventPayload = {
  type: 'PRESENTATION_LOADED' | 'PRESENTATION_UPDATE';
  roomId: string;
  cue: LiveCue;
  timestamp: number;
};

type PresentationClearPayload = {
  type: 'PRESENTATION_CLEAR';
  roomId: string;
  cueId?: string;
  timestamp: number;
};

type PowerPointPollState = 'foreground' | 'background' | 'none';

type PowerPointPollResult = {
  state: PowerPointPollState;
  inSlideshow?: boolean;
  instanceId?: number;
  slideNumber?: number;
  totalSlides?: number;
  title?: string;
  filename?: string;
  editSlideVideos?: VideoTiming[];
  videoDetected?: boolean;
  videoPlaying?: boolean;
  videoDuration?: number;
  videoElapsed?: number;
  videoRemaining?: number;
  videos?: VideoTiming[];
  videoTimingUnavailable?: boolean;
  permissions?: 'granted' | 'missing' | 'unknown';
};

type PresentationSnapshot = {
  instanceId: number;
  slideNumber?: number;
  totalSlides?: number;
  title: string;
  filename?: string;
  videoPlaying?: boolean;
  videoDuration?: number;
  videoElapsed?: number;
  videoRemaining?: number;
  videos?: VideoTiming[];
  videoTimingUnavailable?: boolean;
  permissions?: 'granted' | 'missing' | 'unknown';
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
const liveCuesStore: Map<string, Map<string, { cue: LiveCue; updatedAt: number }>> = new Map();

function getRoomLiveCues(roomId: string): Map<string, { cue: LiveCue; updatedAt: number }> {
  if (liveCuesStore.has(roomId)) return liveCuesStore.get(roomId)!;
  const initial = new Map<string, { cue: LiveCue; updatedAt: number }>();
  liveCuesStore.set(roomId, initial);
  return initial;
}

function updateRoomActiveLiveCueId(roomId: string, activeLiveCueId: string | null) {
  const state = getRoomState(roomId);
  if (state.activeLiveCueId === activeLiveCueId) return;
  const now = Date.now();
  const nextState: RoomState = { ...state, activeLiveCueId: activeLiveCueId ?? undefined };
  roomStateStore.set(roomId, nextState);
  scheduleRoomCacheWrite();

  const delta: RoomStateDelta = {
    type: 'ROOM_STATE_DELTA',
    roomId,
    changes: { activeLiveCueId: activeLiveCueId ?? undefined },
    timestamp: now,
  };
  emitToRoom(roomId, 'ROOM_STATE_DELTA', delta);
}

function emitLiveCueCreated(roomId: string, cue: LiveCue) {
  const now = Date.now();
  const roomCues = getRoomLiveCues(roomId);
  roomCues.set(cue.id, { cue, updatedAt: now });
  updateRoomActiveLiveCueId(roomId, cue.id);
  const payload: LiveCueEventPayload = {
    type: 'LIVE_CUE_CREATED',
    roomId,
    cue,
    timestamp: now,
  };
  emitToRoom(roomId, 'LIVE_CUE_CREATED', payload);
}

function emitLiveCueUpdated(roomId: string, cue: LiveCue) {
  const now = Date.now();
  const roomCues = getRoomLiveCues(roomId);
  roomCues.set(cue.id, { cue, updatedAt: now });
  if (cue.status !== 'ended') {
    updateRoomActiveLiveCueId(roomId, cue.id);
  }
  const payload: LiveCueEventPayload = {
    type: 'LIVE_CUE_UPDATED',
    roomId,
    cue,
    timestamp: now,
  };
  console.log(`[ws] LIVE_CUE_UPDATED emit room=${roomId} cue=${cue.id}`);
  emitToRoom(roomId, 'LIVE_CUE_UPDATED', payload);
}

function emitLiveCueEnded(roomId: string, cue: LiveCue) {
  const now = Date.now();
  const roomCues = getRoomLiveCues(roomId);
  roomCues.delete(cue.id);
  const activeId = getRoomState(roomId).activeLiveCueId;
  if (activeId === cue.id) {
    updateRoomActiveLiveCueId(roomId, null);
  }
  const payload: LiveCueEventPayload = {
    type: 'LIVE_CUE_ENDED',
    roomId,
    cue,
    timestamp: now,
  };
  emitToRoom(roomId, 'LIVE_CUE_ENDED', payload);
}

function emitPresentationLoaded(roomId: string, cue: LiveCue) {
  const now = Date.now();
  const payload: PresentationEventPayload = {
    type: 'PRESENTATION_LOADED',
    roomId,
    cue,
    timestamp: now,
  };
  emitToRoom(roomId, 'PRESENTATION_LOADED', payload);
}

function emitPresentationUpdate(roomId: string, cue: LiveCue) {
  const now = Date.now();
  const payload: PresentationEventPayload = {
    type: 'PRESENTATION_UPDATE',
    roomId,
    cue,
    timestamp: now,
  };
  emitToRoom(roomId, 'PRESENTATION_UPDATE', payload);
}

function emitPresentationClear(roomId: string, cueId?: string) {
  const now = Date.now();
  const payload: PresentationClearPayload = {
    type: 'PRESENTATION_CLEAR',
    roomId,
    cueId,
    timestamp: now,
  };
  emitToRoom(roomId, 'PRESENTATION_CLEAR', payload);
}

const liveCueEmitters = {
  emitLiveCueCreated,
  emitLiveCueUpdated,
  emitLiveCueEnded,
  emitPresentationLoaded,
  emitPresentationUpdate,
  emitPresentationClear,
};
void liveCueEmitters;

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
let pptPollTimer: NodeJS.Timeout | null = null;
let pptPollInFlight = false;
let pptAnnouncedSnapshot: PresentationSnapshot | null = null;
let pptCandidateSnapshot: PresentationSnapshot | null = null;
let pptCandidateSince = 0;
let pptBackgroundSince: number | null = null;
let pptActiveCue: LiveCue | null = null;
let pptHelperProcess: ChildProcessWithoutNullStreams | null = null;
let pptHelperReadline: readline.Interface | null = null;
let pptHelperPending: Array<{ resolve: (line: string | null) => void }> = [];
let pptNativeHelperProcess: ChildProcessWithoutNullStreams | null = null;
let pptNativeReadline: readline.Interface | null = null;
let pptNativePending: Array<{ resolve: (line: string | null) => void }> = [];
let pptNativeHelperLogged = false;

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

function isSocketActive(socketId: string): boolean {
  for (const server of ioServers) {
    if (server.sockets.sockets.has(socketId)) return true;
  }
  return false;
}

function pruneRoomClients(roomId: string): boolean {
  const clients = getRoomClients(roomId);
  let changed = false;
  clients.forEach((entry, clientId) => {
    if (!isSocketActive(entry.socketId)) {
      clients.delete(clientId);
      changed = true;
    }
  });
  return changed;
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
  pruneRoomClients(roomId);
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

function getSettingsPath(): string {
  return path.join(getCacheBaseDir(), 'settings.json');
}

interface CompanionSettings {
  mode: CompanionMode;
  headless?: boolean;
}

async function loadSettings(): Promise<CompanionSettings> {
  const settingsPath = getSettingsPath();
  try {
    const data = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(data) as Partial<CompanionSettings>;
    if (parsed.mode && ['minimal', 'show_control', 'production'].includes(parsed.mode)) {
      return { mode: parsed.mode as CompanionMode, headless: parsed.headless };
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn('[settings] Failed to load settings:', error);
    }
  }
  // Default settings
  return { mode: 'show_control' };
}

async function saveSettings(settings: CompanionSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`[settings] Saved settings: mode=${settings.mode}`);
  } catch (error) {
    console.error('[settings] Failed to save settings:', error);
  }
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

function updateTrayMenu(token: string, expiresAt: number) {
  if (!tray) return;

  const clientCount = getConnectedClientsCount();

  const menuTemplate = [
    { label: `${APP_LABEL} - ${getModeLabel(currentCompanionMode)}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Mode',
      submenu: [
        {
          label: 'Minimal',
          type: 'radio',
          checked: currentCompanionMode === 'minimal',
          click: () => setCompanionMode('minimal', token, expiresAt)
        },
        {
          label: 'Show Control',
          type: 'radio',
          checked: currentCompanionMode === 'show_control',
          click: () => setCompanionMode('show_control', token, expiresAt)
        },
        {
          label: 'Production',
          type: 'radio',
          checked: currentCompanionMode === 'production',
          click: () => setCompanionMode('production', token, expiresAt)
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Copy token',
      click: () => clipboard.writeText(token)
    },
    { label: 'Show Status Window', click: () => showStatusWindow(token, expiresAt) },
    { label: 'Quit', click: () => app.quit() }
  ] as Electron.MenuItemConstructorOptions[];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  trayContextMenu = contextMenu;

  // Always set tray context menu (Darwin too)
  tray.setContextMenu(contextMenu);

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: APP_LABEL, submenu: menuTemplate }])
    );
  }
  tray.setToolTip(`${APP_LABEL} - ${getModeLabel(currentCompanionMode)} (${clientCount} clients)`);
}

function openTrayMenu() {
  if (!tray || !trayContextMenu) return;
  tray.popUpContextMenu(trayContextMenu);
}

async function setCompanionMode(mode: CompanionMode, token: string, expiresAt: number) {
  if (mode === currentCompanionMode) return;

  const oldMode = currentCompanionMode;
  currentCompanionMode = mode;

  console.log(`[mode] Changed mode from ${oldMode} to ${mode}`);

  // Save to settings
  await saveSettings({ mode });

  // Update tray menu
  updateTrayMenu(token, expiresAt);

  // Update status window if open
  updateStatusWindow(token, expiresAt);

  // Start or stop PowerPoint detection based on capabilities
  const caps = getCompanionCapabilities();
  if (caps.powerpoint && !pptPollTimer) {
    startPowerPointDetection();
  } else if (!caps.powerpoint && pptPollTimer) {
    clearInterval(pptPollTimer);
    pptPollTimer = null;
    logPptInfo('[ppt] detection stopped (mode change)');
    stopPowerPointHelper('mode change');
    stopPptProbeHelper('mode change');
  }

  // Notify connected clients about capability change (live update, no reconnect required)
  ioServers.forEach((server) => {
    server.emit('COMPANION_MODE_CHANGED', {
      type: 'COMPANION_MODE_CHANGED',
      companionMode: mode,
      capabilities: caps,
      timestamp: Date.now()
    });
  });
}

function createTray(token: string, expiresAt: number) {
  const icon = nativeImage.createFromBuffer(getTrayPng());
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  if (process.platform === 'darwin') {
    tray.setTitle('OnTime');
  }

  // Left click opens status window; right click opens the tray menu.
  tray.on('click', () => showStatusWindow(token, expiresAt));
  tray.on('right-click', () => openTrayMenu());

  updateTrayMenu(token, expiresAt);

  // Update menu periodically to refresh client count
  setInterval(() => updateTrayMenu(token, expiresAt), 5000);
}

function generateStatusHtml(token: string, expiresAt: number): string {
  const caps = getCompanionCapabilities();
  const clientCount = getConnectedClientsCount();
  const expiryDate = new Date(expiresAt).toLocaleString();
  const memUsage = process.memoryUsage();
  const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
  const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>OnTime Companion Status</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      padding: 16px;
      min-height: 100vh;
    }
    h1 { font-size: 16px; margin-bottom: 12px; color: #4ade80; }
    .section { margin-bottom: 12px; }
    .section-title { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 6px; }
    .value { font-size: 13px; margin-bottom: 2px; }
    .value.large { font-size: 18px; font-weight: 600; }
    .capability { display: inline-block; padding: 4px 8px; margin: 2px; border-radius: 4px; font-size: 12px; }
    .capability.enabled { background: #22c55e33; color: #4ade80; }
    .capability.disabled { background: #ef444433; color: #f87171; }
    .mode-btn {
      display: block;
      width: 100%;
      padding: 10px;
      margin: 4px 0;
      border: 1px solid #333;
      border-radius: 6px;
      background: #2a2a3e;
      color: #eee;
      cursor: pointer;
      font-size: 14px;
      text-align: left;
    }
    .mode-btn:hover { background: #3a3a4e; }
    .mode-btn.active { background: #4ade8033; border-color: #4ade80; }
    .token-display {
      font-family: monospace;
      font-size: 11px;
      background: #2a2a3e;
      padding: 6px 8px;
      border-radius: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .btn {
      padding: 7px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-primary { background: #4ade80; color: #1a1a2e; }
    .btn-secondary { background: #333; color: #eee; }
    .btn-tertiary { background: #1f2937; color: #e5e7eb; }
    .stats { display: flex; gap: 12px; }
    .stat { flex: 1; }
    .token-row { display: flex; gap: 8px; align-items: center; }
    .token-row .token-display { flex: 1; }
    .footer-actions { display: flex; gap: 8px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>OnTime Companion</h1>

  <div class="section">
    <div class="section-title">Mode</div>
    <button class="mode-btn ${currentCompanionMode === 'minimal' ? 'active' : ''}" onclick="setMode('minimal')">
      Minimal - WebSocket relay only
    </button>
    <button class="mode-btn ${currentCompanionMode === 'show_control' ? 'active' : ''}" onclick="setMode('show_control')">
      Show Control - + PowerPoint monitoring
    </button>
    <button class="mode-btn ${currentCompanionMode === 'production' ? 'active' : ''}" onclick="setMode('production')">
      Production - + External video monitoring
    </button>
  </div>

  <div class="section">
    <span class="capability ${caps.powerpoint ? 'enabled' : 'disabled'}">PowerPoint ${caps.powerpoint ? '✓' : '✗'}</span>
    <span class="capability ${caps.externalVideo ? 'enabled' : 'disabled'}">External Video ${caps.externalVideo ? '✓' : '✗'}</span>
    <span class="capability ${caps.fileOperations ? 'enabled' : 'disabled'}">File Ops ${caps.fileOperations ? '✓' : '✗'}</span>
  </div>

  <div class="section">
    <div class="section-title">Status</div>
    <div class="stats">
      <div class="stat">
        <div class="value large">${clientCount}</div>
        <div style="font-size: 12px; color: #888;">Connected Clients</div>
      </div>
      <div class="stat">
        <div class="value">${heapMB} MB heap</div>
        <div class="value">${rssMB} MB RSS</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Token</div>
    <div class="token-row">
      <div class="token-display">${token.slice(0, 16)}...${token.slice(-8)}</div>
      <button class="btn btn-primary" onclick="copyToken()">Copy</button>
    </div>
    <div style="font-size: 11px; color: #888; margin-top: 4px;">Expires: ${expiryDate}</div>
    <div class="footer-actions">
      <button class="btn btn-secondary" onclick="restart()">Restart</button>
      <button class="btn btn-secondary" onclick="quit()">Quit</button>
    </div>
  </div>

  <script>
    // Use navigation-based IPC for security (contextIsolation: true)
    function setMode(mode) {
      location.href = 'ontime://action/set-mode/' + mode;
    }

    function copyToken() {
      location.href = 'ontime://action/copy-token';
    }

    function openTrayMenu() {
      location.href = 'ontime://action/open-tray-menu';
    }

    function restart() {
      location.href = 'ontime://action/restart';
    }

    function quit() {
      location.href = 'ontime://action/quit';
    }
  </script>
</body>
</html>`;
}

function showStatusWindow(token: string, expiresAt: number) {
  if (statusWindow) {
    statusWindow.focus();
    return;
  }

  statusWindow = new BrowserWindow({
    width: 380,
    height: 580,
    title: 'OnTime Companion',
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(generateStatusHtml(token, expiresAt))}`);

  statusWindow.once('ready-to-show', () => {
    statusWindow?.show();
  });

  statusWindow.on('closed', () => {
    statusWindow = null;
  });

  // Handle navigation-based actions (secure alternative to IPC with nodeIntegration)
  statusWindow.webContents.on('will-navigate', (event, url) => {
    // Prevent actual navigation
    event.preventDefault();

    // Parse custom protocol actions
    if (url.startsWith('ontime://action/')) {
      const actionPath = url.replace('ontime://action/', '');
      const [action, ...params] = actionPath.split('/');

      switch (action) {
        case 'set-mode':
          const mode = params[0] as CompanionMode;
          if (['minimal', 'show_control', 'production'].includes(mode)) {
            void setCompanionMode(mode, token, expiresAt);
          }
          break;
        case 'copy-token':
          clipboard.writeText(token);
          break;
        case 'open-tray-menu':
          openTrayMenu();
          break;
        case 'restart':
          app.relaunch();
          app.quit();
          break;
        case 'quit':
          app.quit();
          break;
      }
    }
  });
}

function updateStatusWindow(token: string, expiresAt: number) {
  if (!statusWindow) return;
  statusWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(generateStatusHtml(token, expiresAt))}`);
}

function closeStatusWindow() {
  if (statusWindow) {
    statusWindow.close();
    statusWindow = null;
  }
}

function getTrayPng(): Buffer {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVR4nGNgYGD4TyEeNWDUgFEDhocBAJvM/wGi6G+mAAAAAElFTkSuQmCC';
  return Buffer.from(base64, 'base64');
}

function isHeadlessMode(): boolean {
  // Check environment variable
  if (process.env.COMPANION_HEADLESS === 'true') return true;
  // Check CLI argument
  if (process.argv.includes('--headless')) return true;
  return false;
}

function getEnvMode(): CompanionMode | null {
  const envMode = process.env.COMPANION_MODE;
  if (envMode && ['minimal', 'show_control', 'production'].includes(envMode)) {
    return envMode as CompanionMode;
  }
  return null;
}

// RAM measurement logging
let ramMeasurementTimer: NodeJS.Timeout | null = null;
let ramSamples: { heap: number; rss: number }[] = [];

function startRamMeasurement() {
  // Start measuring after 60 seconds idle
  setTimeout(() => {
    console.log('[ram] Starting RAM measurement (3 samples at 10s intervals)');
    ramSamples = [];

    const takeSample = () => {
      const mem = process.memoryUsage();
      const sample = {
        heap: mem.heapUsed / 1024 / 1024,
        rss: mem.rss / 1024 / 1024
      };
      ramSamples.push(sample);
      console.log(`[ram] Sample ${ramSamples.length}: heap=${sample.heap.toFixed(1)}MB, rss=${sample.rss.toFixed(1)}MB`);

      if (ramSamples.length >= 3) {
        const avgHeap = ramSamples.reduce((sum, s) => sum + s.heap, 0) / ramSamples.length;
        const avgRss = ramSamples.reduce((sum, s) => sum + s.rss, 0) / ramSamples.length;
        console.log(`[ram] Average after 60s idle: heap=${avgHeap.toFixed(1)}MB, rss=${avgRss.toFixed(1)}MB, mode=${currentCompanionMode}`);

        // Check against targets
        const target = currentCompanionMode === 'minimal' ? 50 : currentCompanionMode === 'show_control' ? 100 : 150;
        if (avgRss <= target) {
          console.log(`[ram] ✓ Within target (${target}MB)`);
        } else {
          console.warn(`[ram] ✗ Exceeds target (${target}MB) by ${(avgRss - target).toFixed(1)}MB`);
        }

        if (ramMeasurementTimer) {
          clearInterval(ramMeasurementTimer);
          ramMeasurementTimer = null;
        }
      }
    };

    // Take first sample immediately, then every 10 seconds
    takeSample();
    ramMeasurementTimer = setInterval(takeSample, 10000);
  }, 60000);
}

async function bootstrap() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  const headless = isHeadlessMode();
  if (headless) {
    console.log('[startup] Running in headless mode');
  }

  app.on('second-instance', () => {
    // Show status window when a second instance is launched (if not headless)
    if (!headless && currentToken && currentTokenExpiresAt) {
      showStatusWindow(currentToken, currentTokenExpiresAt);
    }
  });

  app.on('window-all-closed', () => {
    // Keep tray running even if a future window is closed.
  });

  app.on('activate', () => {
    // Show status window on dock click (macOS)
    if (!headless && currentToken && currentTokenExpiresAt) {
      showStatusWindow(currentToken, currentTokenExpiresAt);
    }
  });

  await app.whenReady();

  // Load settings (mode persisted from previous run)
  const settings = await loadSettings();

  // Environment variable overrides persisted setting
  const envMode = getEnvMode();
  if (envMode) {
    currentCompanionMode = envMode;
    console.log(`[startup] Mode set from COMPANION_MODE env: ${envMode}`);
  } else {
    currentCompanionMode = settings.mode;
    console.log(`[startup] Mode loaded from settings: ${currentCompanionMode}`);
  }

  await initializePptDebugLogging();

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

  // Only create tray if not in headless mode
  if (!headless) {
    createTray(token, expiresAt);
  }

  startSocketServer();
  startSecureSocketServer(tls);
  startTokenServer(token, expiresAt);
  startSecureTokenServer(token, expiresAt, tls);

  // Only start PowerPoint detection if mode supports it
  const caps = getCompanionCapabilities();
  if (caps.powerpoint) {
    startPowerPointDetection();
  } else {
    logPptInfo('[ppt] detection disabled (mode does not support PowerPoint)');
  }

  // Start RAM measurement for validation
  startRamMeasurement();

  console.log(`[startup] OnTime Companion started in ${getModeLabel(currentCompanionMode)}${headless ? ' (headless)' : ''}`);
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
    stopPowerPointHelper('app quit');
    stopPptProbeHelper('app quit');
    pptProbeManager.stop();
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

function sendFeatureUnavailable(res: any, origin?: string) {
  sendJson(res, 403, { error: 'FEATURE_UNAVAILABLE' }, origin);
}

function getRedactedPath(filePath: string): string {
  const base = path.basename(filePath);
  const hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  return `${base}#${hash}`;
}

function swapUtf16Bytes(buffer: Buffer): Buffer {
  const length = buffer.length - (buffer.length % 2);
  const swapped = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }
  return swapped;
}

function decodeJsonBody(buffer: Buffer, contentType?: string): string {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.slice(2).toString('utf16le');
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return swapUtf16Bytes(buffer.slice(2)).toString('utf16le');
    }
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  const charsetMatch = contentType?.match(/charset=([^;]+)/i);
  const charset = charsetMatch?.[1]?.trim().toLowerCase();
  if (charset === 'utf-16le' || charset === 'utf16le' || charset === 'utf-16') {
    return buffer.toString('utf16le');
  }
  if (charset === 'utf-16be' || charset === 'utf16be') {
    return swapUtf16Bytes(buffer).toString('utf16le');
  }
  if (buffer.length >= 4) {
    const sampleLength = Math.min(buffer.length, 256);
    let zeroCount = 0;
    for (let i = 1; i < sampleLength; i += 2) {
      if (buffer[i] === 0x00) zeroCount += 1;
    }
    const zeroRatio = zeroCount / Math.ceil(sampleLength / 2);
    if (zeroRatio > 0.4) {
      return buffer.toString('utf16le');
    }
  }
  return buffer.toString('utf8');
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
        const raw = decodeJsonBody(Buffer.concat(chunks), req.headers?.['content-type']);
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

function isNetworkPath(candidatePath: string): boolean {
  if (process.platform !== 'win32') return false;
  const normalized = candidatePath.replace(/\//g, '\\');
  return normalized.startsWith('\\\\') || normalized.startsWith('\\\\?\\UNC\\');
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

async function validateAndResolveUserPath(
  inputPath: string,
  options?: { requireFile?: boolean },
): Promise<string | null> {
  if (!inputPath || typeof inputPath !== 'string') return null;

  const home = os.homedir();
  const candidate = path.isAbsolute(inputPath) ? inputPath : path.join(home, inputPath);

  try {
    const resolvedHome = await fs.realpath(home);

    if (isNetworkPath(candidate)) {
      return null;
    }

    const requireFile = options?.requireFile !== false;
    if (requireFile) {
      const resolved = await fs.realpath(candidate);

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
    }

    const resolvedCandidate = path.resolve(candidate);
    const resolvedParent = await fs.realpath(path.dirname(resolvedCandidate));

    if (isBlockedSystemPath(resolvedParent) || isBlockedSystemPath(resolvedCandidate)) {
      return null;
    }

    if (!isSubPath(resolvedHome, resolvedParent)) {
      return null;
    }

    try {
      const stat = await fs.stat(resolvedCandidate);
      if (!stat.isFile()) {
        return null;
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        return null;
      }
    }

    return resolvedCandidate;
  } catch {
    return null;
  }
}

async function validateExistingUserFile(inputPath: string): Promise<string | null> {
  return validateAndResolveUserPath(inputPath, { requireFile: true });
}

async function validatePotentialUserFile(inputPath: string): Promise<string | null> {
  return validateAndResolveUserPath(inputPath, { requireFile: false });
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
      path.join(app.getAppPath(), 'bin', exe),
      path.join(__dirname, '..', 'bin', exe),
      exe,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (path.isAbsolute(candidate)) {
        if (fsSync.existsSync(candidate)) {
          ffprobePath = candidate;
          break;
        }
      } else {
        ffprobePath = candidate;
        break;
      }
    }

    if (!ffprobePath) ffprobePath = exe;
    console.log(`[file] ffprobe selected: ${ffprobePath}`);
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

function getPresentationRoomIds(): string[] {
  const rooms = new Set<string>();
  roomClientStore.forEach((_clients, roomId) => rooms.add(roomId));
  roomStateStore.forEach((_state, roomId) => rooms.add(roomId));
  return Array.from(rooms);
}

function snapshotsIdentityEqual(a: PresentationSnapshot | null, b: PresentationSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.instanceId === b.instanceId &&
    a.slideNumber === b.slideNumber &&
    a.totalSlides === b.totalSlides &&
    a.title === b.title &&
    a.filename === b.filename
  );
}

function snapshotsTimingEqual(a: PresentationSnapshot | null, b: PresentationSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.videoPlaying === b.videoPlaying &&
    a.videoDuration === b.videoDuration &&
    a.videoElapsed === b.videoElapsed &&
    a.videoRemaining === b.videoRemaining &&
    a.videoTimingUnavailable === b.videoTimingUnavailable &&
    videoListsEqual(a.videos, b.videos)
  );
}

function videoListsEqual(a?: VideoTiming[], b?: VideoTiming[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left?.id !== right?.id ||
      left?.name !== right?.name ||
      left?.duration !== right?.duration ||
      left?.elapsed !== right?.elapsed ||
      left?.remaining !== right?.remaining ||
      left?.playing !== right?.playing
    ) {
      return false;
    }
  }
  return true;
}

function buildPowerPointCue(snapshot: PresentationSnapshot, startedAt: number): LiveCue {
  const derivedRemaining =
    snapshot.videoDuration !== undefined && snapshot.videoElapsed !== undefined
      ? snapshot.videoDuration - snapshot.videoElapsed
      : undefined;
  const metadata: LiveCueMetadata = {
    slideNumber: snapshot.slideNumber,
    totalSlides: snapshot.totalSlides,
    filename: snapshot.filename,
    player: 'powerpoint',
    instanceId: snapshot.instanceId,
    videoPlaying: snapshot.videoPlaying,
    videoDuration: snapshot.videoDuration,
    videoElapsed: snapshot.videoElapsed,
    videoRemaining: snapshot.videoRemaining ?? derivedRemaining,
    videos: snapshot.videos,
    videoTimingUnavailable: snapshot.videoTimingUnavailable,
  };

  if (process.platform === 'darwin') {
    const hasVideoTiming = snapshot.videoDuration !== undefined || snapshot.videoElapsed !== undefined;
    if (!hasVideoTiming) {
      metadata.videoTimingUnavailable = true;
    }
  }

  return {
    id: `powerpoint:${snapshot.instanceId}`,
    source: 'powerpoint',
    title: snapshot.title,
    startedAt,
    status: 'playing',
    metadata,
  };
}

function commitPresentationSnapshot(snapshot: PresentationSnapshot | null) {
  const roomIds = getPresentationRoomIds();
  if (!snapshot) {
    if (!pptAnnouncedSnapshot) return;
    const cueId = `powerpoint:${pptAnnouncedSnapshot.instanceId}`;
    if (pptActiveCue) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' };
      roomIds.forEach((roomId) => {
        emitLiveCueEnded(roomId, endedCue);
        emitPresentationClear(roomId, cueId);
      });
    } else {
      roomIds.forEach((roomId) => emitPresentationClear(roomId, cueId));
    }
    pptAnnouncedSnapshot = null;
    pptActiveCue = null;
    return;
  }

  const cueId = `powerpoint:${snapshot.instanceId}`;
  const startedAt = pptActiveCue?.id === cueId ? pptActiveCue.startedAt ?? Date.now() : Date.now();
  const cue = buildPowerPointCue(snapshot, startedAt);

  if (!pptActiveCue || pptActiveCue.id !== cueId) {
    if (pptActiveCue && pptActiveCue.id !== cueId) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' };
      roomIds.forEach((roomId) => emitLiveCueEnded(roomId, endedCue));
    }
    roomIds.forEach((roomId) => {
      emitLiveCueCreated(roomId, cue);
      emitPresentationLoaded(roomId, cue);
    });
  } else {
    roomIds.forEach((roomId) => {
      emitLiveCueUpdated(roomId, cue);
      emitPresentationUpdate(roomId, cue);
    });
  }

  pptActiveCue = cue;
  pptAnnouncedSnapshot = snapshot;
}

function updatePresentationCandidate(snapshot: PresentationSnapshot | null) {
  const now = Date.now();
  if (pptAnnouncedSnapshot && snapshotsIdentityEqual(snapshot, pptAnnouncedSnapshot)) {
    if (!snapshotsTimingEqual(snapshot, pptAnnouncedSnapshot)) {
      commitPresentationSnapshot(snapshot);
    }
    return;
  }

  if (!snapshotsIdentityEqual(snapshot, pptCandidateSnapshot)) {
    pptCandidateSnapshot = snapshot;
    pptCandidateSince = now;
  } else if (!snapshotsTimingEqual(snapshot, pptCandidateSnapshot)) {
    // Same identity but timing/videos changed - update content without resetting debounce
    pptCandidateSnapshot = snapshot;
  }

  if (now - pptCandidateSince < PPT_DEBOUNCE_MS) {
    return;
  }

  if (snapshotsIdentityEqual(snapshot, pptAnnouncedSnapshot)) {
    return;
  }

  commitPresentationSnapshot(snapshot);
}

function resolvePptProbePath(): string | null {
  // Windows-only native helper binary; packaged under resources/bin or local dev bin.
  const candidates = [
    path.join(process.resourcesPath ?? '', 'bin', 'ppt-probe.exe'),
    path.join(__dirname, '..', 'bin', 'ppt-probe.exe')
  ];
  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function stopPptProbeHelper(reason: string) {
  // Windows-only helper shutdown to avoid orphaned processes.
  if (!pptNativeHelperProcess) return;
  logPptInfo('[ppt] native helper stopped', { reason });
  try {
    pptNativeHelperProcess.stdin.write('exit\n');
  } catch {
    // ignore write failures during shutdown
  }
  pptNativeHelperProcess.kill();
  pptNativeHelperProcess = null;
  pptNativeReadline?.close();
  pptNativeReadline = null;
  pptNativePending = [];
}

function ensurePptProbeHelper(): boolean {
  // Prefer the native STA helper to avoid COM collection issues from short-lived shells.
  if (pptNativeHelperProcess && pptNativeHelperProcess.exitCode === null) return true;
  stopPptProbeHelper('restart');
  const probePath = resolvePptProbePath();
  if (!probePath) {
    logPptInfo('[ppt] native helper missing; falling back to PowerShell');
    return false;
  }
  pptNativeHelperProcess = spawn(probePath, [], { windowsHide: true });
  pptNativeReadline = readline.createInterface({ input: pptNativeHelperProcess.stdout });
  pptNativeReadline.on('line', (line) => {
    const pending = pptNativePending.shift();
    if (pending) {
      pending.resolve(line);
    }
  });
  pptNativeHelperProcess.stderr.on('data', (buf) => {
    logPptVerbose('[ppt] native helper stderr', buf.toString('utf8').trim());
  });
  pptNativeHelperProcess.on('exit', (code) => {
    logPptInfo('[ppt] native helper exited', { code });
    pptNativeHelperProcess = null;
    pptNativeReadline?.close();
    pptNativeReadline = null;
    pptNativePending = [];
    pptNativeHelperLogged = false;
  });
  if (!pptNativeHelperLogged) {
    logPptInfo('[ppt] native helper started', { path: probePath });
    pptNativeHelperLogged = true;
  }
  return true;
}

async function pollPowerPointViaNativeHelper(): Promise<PowerPointPollResult | null> {
  if (process.platform !== 'win32') return null;
  if (!ensurePptProbeHelper()) return null;
  const helper = pptNativeHelperProcess;
  if (!helper || helper.exitCode !== null) return null;

  return await new Promise((resolve) => {
    const pending = {
      resolve: (line: string | null) => {
        clearTimeout(timeout);
        if (!line) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(line) as PowerPointPollResult);
        } catch (error) {
          console.warn(`[ppt] Failed to parse native helper output: ${String(error)}`);
          resolve(null);
        }
      }
    };
    const timeout = setTimeout(() => {
      const index = pptNativePending.indexOf(pending);
      if (index >= 0) {
        pptNativePending.splice(index, 1);
      }
      resolve(null);
    }, 8000);
    pptNativePending.push(pending);
    try {
      helper.stdin.write('poll\n');
    } catch {
      clearTimeout(timeout);
      const index = pptNativePending.indexOf(pending);
      if (index >= 0) {
        pptNativePending.splice(index, 1);
      }
      resolve(null);
    }
  });
}

function buildPowerPointHelperScript(pollScript: string): string {
  return `
function Invoke-PptPoll {
${pollScript}
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'poll') { Invoke-PptPoll }
  elseif ($line -eq 'exit') { break }
}
`.trim();
}

function stopPowerPointHelper(reason: string) {
  if (!pptHelperProcess) return;
  logPptInfo('[ppt] helper stopped', { reason });
  try {
    pptHelperProcess.stdin.write('exit\n');
  } catch {
    // ignore write failures during shutdown
  }
  pptHelperProcess.kill();
  pptHelperProcess = null;
  pptHelperReadline?.close();
  pptHelperReadline = null;
  pptHelperPending = [];
}

function ensurePowerPointHelper(pollScript: string) {
  if (pptHelperProcess && pptHelperProcess.exitCode === null) return;
  stopPowerPointHelper('restart');
  const powershellPath = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const helperScript = buildPowerPointHelperScript(pollScript);
  pptHelperProcess = spawn(
    powershellPath,
    ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', helperScript],
    { windowsHide: true }
  );
  pptHelperReadline = readline.createInterface({ input: pptHelperProcess.stdout });
  pptHelperReadline.on('line', (line) => {
    const pending = pptHelperPending.shift();
    if (pending) {
      pending.resolve(line);
    }
  });
  pptHelperProcess.stderr.on('data', (buf) => {
    logPptVerbose('[ppt] helper stderr', buf.toString('utf8').trim());
  });
  pptHelperProcess.on('exit', (code) => {
    logPptInfo('[ppt] helper exited', { code });
    pptHelperProcess = null;
    pptHelperReadline?.close();
    pptHelperReadline = null;
    pptHelperPending = [];
  });
}

async function pollPowerPointViaHelper(
  pollScript: string
): Promise<PowerPointPollResult | null> {
  if (process.platform !== 'win32') return null;
  ensurePowerPointHelper(pollScript);
  const helper = pptHelperProcess;
  if (!helper || helper.exitCode !== null) return null;

  return await new Promise((resolve) => {
    const pending = {
      resolve: (line: string | null) => {
        clearTimeout(timeout);
        if (!line) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(line) as PowerPointPollResult);
        } catch (error) {
          console.warn(`[ppt] Failed to parse PowerShell output: ${String(error)}`);
          resolve(null);
        }
      }
    };
    const timeout = setTimeout(() => {
      const index = pptHelperPending.indexOf(pending);
      if (index >= 0) {
        pptHelperPending.splice(index, 1);
      }
      resolve(null);
    }, 8000);
    pptHelperPending.push(pending);
    try {
      helper.stdin.write('poll\n');
    } catch {
      clearTimeout(timeout);
      const index = pptHelperPending.indexOf(pending);
      if (index >= 0) {
        pptHelperPending.splice(index, 1);
      }
      resolve(null);
    }
  });
}

async function fetchPowerPointStatus(): Promise<PowerPointPollResult | null> {
  if (process.platform === 'darwin') {
    const script = `
set res to "{\\"state\\":\\"none\\"}"
try
  tell application "Microsoft PowerPoint"
    set isRunning to true
    set isFront to frontmost
    set hasPres to (count of presentations) > 0
    set isInShow to (count of slide show windows) > 0
    
    set maxSlides to 0
    set filePath to ""
    if hasPres then
      try
        set activePres to active presentation
        set maxSlides to count of slides of activePres
        set filePath to (full name of activePres) as string
      on error
        -- handle unsaved or busy presentation
      end try
    end if
    
    set curSlide to 0
    if isInShow then
      try
        set curSlide to (current show position of slide show view of slide show window 1)
      on error
        set curSlide to 0
      end try
    end if
    
    set thePid to 0
    tell application "System Events"
      try
        set thePid to unix id of process "Microsoft PowerPoint"
      end try
    end tell

    set stateStr to "background"
    if isFront then set stateStr to "foreground"
    set showStr to "false"
    if isInShow then set showStr to "true"

    set res to "{\\"state\\":\\"" & stateStr & "\\",\\"instanceId\\":" & thePid & ",\\"filename\\":\\"" & filePath & "\\",\\"inSlideshow\\":" & showStr
    if curSlide > 0 then set res to res & ",\\"slideNumber\\":" & curSlide
    if maxSlides > 0 then set res to res & ",\\"totalSlides\\":" & maxSlides
    set res to res & "}"
  end tell
on error err
  set res to "{\\"state\\":\\"none\\",\\"error\\":\\"" & err & "\\"}"
end try
res
`.trim();


    void writePptScript(script);
    return await new Promise((resolve) => {
      const child = spawn('osascript', ['-e', script]);
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 4000);

      child.stdout.on('data', (buf) => {
        stdout += buf.toString('utf8');
      });
      child.stderr.on('data', (buf) => {
        stderr += buf.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timeout);
        void appendPptLog('[ppt] osascript error: spawn_failed');
        resolve(null);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.warn(`[ppt] osascript failed (code=${code}): ${stderr.trim()}`);
          void appendPptLog(
            `[ppt] osascript exit code=${code} stderr=${stderr.trim() || 'none'}`
          );
          void appendPptLog('[ppt] osascript script saved to ppt.script.applescript');
          resolve(null);
          return;
        }
        const raw = stdout.trim();
        if (!raw) {
          void appendPptLog('[ppt] osascript exit ok but stdout empty');
          resolve(null);
          return;
        }
        try {
          logPptVerbose('[ppt] osascript raw', raw);
          void appendPptLog(`[ppt] osascript raw ${raw}`);
          const parsed = JSON.parse(raw) as PowerPointPollResult;

          // MERGE: Persistent Probe Data (macOS Only)
          const probeStatus = pptProbeManager.getStatus();
          if (probeStatus) {
            if (parsed.instanceId === 0 && probeStatus.instanceId) {
              parsed.instanceId = probeStatus.instanceId;
            }
            if (pptDebugVerboseEnabled) {
              logPptInfo(`[ppt-probe] Matching probe pid=${probeStatus.instanceId} against parsed pid=${parsed.instanceId}`);
            }
            if (probeStatus.instanceId === parsed.instanceId) {
              if (probeStatus.videos && probeStatus.videos.length > 0) {
                parsed.videos = probeStatus.videos.map((v) => ({
                  name: v.name,
                  duration: v.duration,
                  elapsed: v.elapsed,
                  remaining:
                    typeof v.duration === 'number' && typeof v.elapsed === 'number'
                      ? Math.max(0, v.duration - v.elapsed)
                      : undefined,
                  playing: v.playing
                }));
                // For backward compatibility with single-video fields
                const first = probeStatus.videos[0];
                parsed.videoDetected = true;
                parsed.videoDuration = first.duration;
                parsed.videoElapsed = first.elapsed;
                parsed.videoPlaying = first.playing;
              }
              if (probeStatus.error) {
                logPptInfo(`[ppt-probe] Probe Error: ${probeStatus.error}`);
              }
              parsed.permissions = probeStatus.permissions;
            }
          }
          resolve(parsed);
        } catch (error) {
          console.warn(`[ppt] Failed to parse osascript output: ${String(error)}`);
          void appendPptLog(`[ppt] parse error: ${String(error)}`);
          resolve(null);
        }
      });
    });
  }

  if (process.platform !== 'win32') {
    return { state: 'none' };
  }

  const nativeResult = await pollPowerPointViaNativeHelper();
  if (nativeResult) {
    return nativeResult;
  }

  const script = `
$debugEnabled = ${pptDebugVerboseEnabled ? '$true' : '$false'}
$ErrorActionPreference = 'Stop'
if (-not ("Win32" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
}
$hwnd = [Win32]::GetForegroundWindow()
$targetPid = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
$hasPowerpoint = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$proc = $null
if ($targetPid -ne 0) { $proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue }
if (-not $proc -or $proc.ProcessName -ne 'POWERPNT') {
  if ($hasPowerpoint) {
    @{ state = 'background' } | ConvertTo-Json -Compress
  } else {
    @{ state = 'none' } | ConvertTo-Json -Compress
  }
  return
}
$ppt = $null
try { $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { $ppt = $null }
if (-not $ppt) {
  @{ state = 'foreground'; instanceId = $targetPid } | ConvertTo-Json -Compress
  return
}
$protectedViewCount = 0
try { $protectedViewCount = $ppt.ProtectedViewWindows.Count } catch { $protectedViewCount = 0 }
$slideIndex = $null
function Try-GetProp($obj, $name) {
  try { return $obj.$name } catch { return $null }
}

function Convert-ToMs($value) {
  if ($value -eq $null) { return $null }
  $num = [double]$value
  if (-not [double]::IsFinite($num) -or $num -le 0) { return $null }
  if ($num -lt 1000) { return [int][math]::Round($num * 1000) }
  return [int][math]::Round($num)
}
$ssWinError = $null
$ssViewError = $null
$ssPresentationError = $null
$slideIndexError = $null
$targetSlideError = $null
$slideShapesError = $null
$viewSlideError = $null
$viewShapesError = $null
$editSlideError = $null
$editShapesError = $null
$inSlideshow = $false
$ssWinCount = 0
$ssWinFound = $false
$ssViewFound = $false
$ssShowPositionRaw = $null
try { $ssWinCount = $ppt.SlideShowWindows.Count } catch { $ssWinCount = 0 }
$inSlideshow = $ssWinCount -gt 0
$ssWin = $null
if ($ssWinCount -gt 0) {
  try { $ssWin = $ppt.SlideShowWindows.Item(1) } catch { $ssWin = $null; $ssWinError = $_.Exception.Message }
}
if ($ssWin) {
  $ssWinFound = $true
  try {
    $ssView = $ssWin.View
    if ($ssView) {
      $ssViewFound = $true
      $ssShowPositionRaw = Try-GetProp $ssView 'CurrentShowPosition'
    }
  } catch {
    $ssViewError = $_.Exception.Message
  }
}
$presentation = $ppt.ActivePresentation
$activePresentationName = $null
$activePresentationFullName = $null
try { $activePresentationName = $presentation.Name } catch { $activePresentationName = $null }
try { $activePresentationFullName = $presentation.FullName } catch { $activePresentationFullName = $null }
if ($ssWin) {
  try { $presentation = $ssWin.Presentation } catch { $presentation = $presentation; $ssPresentationError = $_.Exception.Message }
}
if (-not $presentation) {
  @{ state = 'foreground'; instanceId = $targetPid } | ConvertTo-Json -Compress
  return
}
$presentationPath = $null
$presentationSaved = $null
$presentationReadOnly = $null
$presentationSlidesCount = $null
try { $presentationPath = $presentation.Path } catch { $presentationPath = $null }
try { $presentationSaved = $presentation.Saved } catch { $presentationSaved = $null }
try { $presentationReadOnly = $presentation.ReadOnly } catch { $presentationReadOnly = $null }
try { $presentationSlidesCount = $presentation.Slides.Count } catch { $presentationSlidesCount = $null }
$ssPresentationName = $null
$ssPresentationFullName = $null
if ($ssWin) {
  try { $ssPresentationName = $presentation.Name } catch { $ssPresentationName = $null }
  try { $ssPresentationFullName = $presentation.FullName } catch { $ssPresentationFullName = $null }
}

$mediaCandidates = @()
function Add-MediaCandidate($shape) {
  try {
    $mediaCandidates += $shape
  } catch {
    $mediaCandidates = $mediaCandidates
  }
}

function Collect-MediaShapes($shapes) {
  if (-not $shapes) { return }
  for ($i = 1; $i -le $shapes.Count; $i++) {
    $shape = $shapes.Item($i)
    $shapeType = Try-GetProp $shape 'Type'
    $mediaFormat = $null
    try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
    $isMedia = $mediaFormat -ne $null
    if (-not $isMedia -and $shapeType -eq 16) { $isMedia = $true } # msoMedia
    if (-not $isMedia) {
      try {
        $placeholder = $shape.PlaceholderFormat
        $containedType = Try-GetProp $placeholder 'ContainedType'
        if ($containedType -eq 16) { $isMedia = $true }
      } catch {
        $isMedia = $isMedia
      }
    }
    if ($isMedia) {
      Add-MediaCandidate $shape
    }
    if ($shapeType -eq 6) { # msoGroup
      try { Collect-MediaShapes $shape.GroupItems } catch { }
    }
  }
}

$videoPlaying = $null
$videoDurationMs = $null
$videoElapsedMs = $null
$videoRemainingMs = $null
$videoTimingUnavailable = $false
$playerSource = $null
$mediaShapeCount = 0
$mediaLengthRaw = $null
$slideMediaCount = 0
$slideMediaLengthRaw = $null
$slideShapeCount = 0
$slideShapeDebug = @()
$viewSlideShapeCount = 0
$viewSlideMediaCount = 0
$viewSlideMediaLengthRaw = $null
$viewSlideShapeDebug = @()
$candidateCount = 0
$editSlideShapeCount = 0
$editSlideMediaCount = 0
$editSlideMediaLengthRaw = $null
$editSlideShapeDebug = @()
$layoutShapeCount = 0
$layoutMediaCount = 0
$layoutMediaLengthRaw = $null
$layoutShapeDebug = @()
$masterShapeCount = 0
$masterMediaCount = 0
$masterMediaLengthRaw = $null
$masterShapeDebug = @()
$timelineEffectCount = 0
$timelineMediaCount = 0
$timelineMediaLengthRaw = $null
$timelineShapeDebug = @()
$activeSlideShapeCount = $null
$ssPresentationSlideShapeCount = $null
$ssViewSlideShapeCount = $null
$activeSlideShapeError = $null
$ssPresentationSlideShapeError = $null
$ssViewSlideShapeError = $null
$ssPresentationSlideShapeDebug = @()
$apartmentState = $null
$apartmentStateName = $null
$runspaceApartment = $null
$psVersion = $null
$psHostName = $null
$pptVersion = $null
$pptBuild = $null
if ($inSlideshow) {
  if ($ssShowPositionRaw -ne $null) {
    $slideIndex = $ssShowPositionRaw
  } elseif ($ssWin) {
    try { $slideIndex = $ssWin.View.CurrentShowPosition } catch { $slideIndex = $null; $slideIndexError = $_.Exception.Message }
    if ($slideIndex -eq $null) {
      try { $slideIndex = $ssWin.View.Slide.SlideIndex } catch { $slideIndex = $slideIndex; $slideIndexError = $_.Exception.Message }
    }
  }
  try { $apartmentState = [System.Threading.Thread]::CurrentThread.ApartmentState } catch { $apartmentState = $null }
  try { $apartmentStateName = [System.Threading.Thread]::CurrentThread.ApartmentState.ToString() } catch { $apartmentStateName = $null }
  try { $runspaceApartment = $Host.Runspace.ApartmentState.ToString() } catch { $runspaceApartment = $null }
  try { $psVersion = $PSVersionTable.PSVersion.ToString() } catch { $psVersion = $null }
  try { $psHostName = $Host.Name } catch { $psHostName = $null }
  try { $pptVersion = $ppt.Version } catch { $pptVersion = $null }
  try { $pptBuild = $ppt.Build } catch { $pptBuild = $null }
  try {
    $player = $null
    try { $player = $ppt.SlideShowWindows.Item(1).View.Player; if ($player) { $playerSource = 'SlideShowView.Player' } } catch { $player = $null }
    if (-not $player) { try { $player = $ppt.SlideShowWindows.Item(1).View.MediaPlayer; if ($player) { $playerSource = 'SlideShowView.MediaPlayer' } } catch { $player = $null } }
    if (-not $player) { try { $player = $ppt.ActiveWindow.View.Player; if ($player) { $playerSource = 'ActiveWindow.View.Player' } } catch { $player = $null } }
    if ($player) {
      $duration = $null
      $elapsed = $null
      $state = $null
      $duration = Try-GetProp $player 'Duration'
      if ($duration -eq $null) { $duration = Try-GetProp $player 'Length' }
      if ($duration -eq $null) { $duration = Try-GetProp $player 'TotalTime' }
      if ($duration -eq $null) { $duration = Try-GetProp $player 'TotalDuration' }
      $elapsed = Try-GetProp $player 'CurrentPosition'
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'Position' }
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'CurrentTime' }
      if ($elapsed -eq $null) { $elapsed = Try-GetProp $player 'Time' }
      $state = Try-GetProp $player 'State'
      if ($state -eq $null) { $state = Try-GetProp $player 'PlayerState' }
      if ($duration -ne $null) { $duration = [double]$duration }
      if ($elapsed -ne $null) { $elapsed = [double]$elapsed }
      $videoDurationMs = Convert-ToMs $duration
      $videoElapsedMs = Convert-ToMs $elapsed
      if ($videoDurationMs -ne $null -and $videoElapsedMs -ne $null) {
        $videoRemainingMs = [int][math]::Max(0, $videoDurationMs - $videoElapsedMs)
      }
      if ($state -ne $null) { $videoPlaying = ($state -eq 1) }
    }
    try {
      if ($ssWin) {
        $shapes = $ssWin.View.Slide.Shapes
        if ($shapes) {
          $mediaShapeCount = $shapes.Count
          Collect-MediaShapes $shapes
        }
      }
    } catch {
      $mediaShapeCount = $mediaShapeCount
    }
    try {
      if ($slideIndex -ne $null) {
        $targetSlide = $null
        if ($ssWin) {
          try { $targetSlide = $ssWin.Presentation.Slides.Item($ssWin.View.CurrentShowPosition) } catch { $targetSlide = $null; $targetSlideError = $_.Exception.Message }
        }
        if (-not $targetSlide) {
          try { $targetSlide = $presentation.Slides.Item([int]$slideIndex) } catch { $targetSlide = $null; $targetSlideError = $_.Exception.Message }
        }
        if ($presentation -and $slideIndex -ne $null) {
          try { $activeSlideShapeCount = $presentation.Slides.Item([int]$slideIndex).Shapes.Count } catch { $activeSlideShapeCount = $null; $activeSlideShapeError = $_.Exception.Message }
        }
        if ($ssWin -and $slideIndex -ne $null) {
          try {
            $ssSlide = $ssWin.Presentation.Slides.Item([int]$slideIndex)
            $ssPresentationSlideShapeCount = $ssSlide.Shapes.Count
            if ($debugEnabled -and $ssPresentationSlideShapeDebug.Count -lt 6) {
              for ($i = 1; $i -le $ssSlide.Shapes.Count; $i++) {
                $shape = $ssSlide.Shapes.Item($i)
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $shapeName = Try-GetProp $shape 'Name'
                $ssPresentationSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType }
              }
            }
          } catch { $ssPresentationSlideShapeCount = $null; $ssPresentationSlideShapeError = $_.Exception.Message }
        }
        $slideShapes = $null
        try { $slideShapes = $targetSlide.Shapes } catch { $slideShapes = $null; $slideShapesError = $_.Exception.Message }
        if ($slideShapes) {
          try { $slideShapeCount = $slideShapes.Count } catch { $slideShapeCount = 0; $slideShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $slideShapes.Count; $i++) {
            $shape = $slideShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $slideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $slideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $slideMediaCount += 1
              if ($slideMediaLengthRaw -eq $null) {
                $slideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $slideShapes
        }
        try {
          $timeline = $targetSlide.TimeLine
          if ($timeline) {
            $sequence = $timeline.MainSequence
            if ($sequence) {
              $timelineEffectCount = $sequence.Count
              for ($i = 1; $i -le $sequence.Count; $i++) {
                $effect = $sequence.Item($i)
                $effectShape = $null
                try { $effectShape = $effect.Shape } catch { $effectShape = $null }
                if ($effectShape) {
                  $mediaFormat = $null
                  try { $mediaFormat = $effectShape.MediaFormat } catch { $mediaFormat = $null }
                  if ($debugEnabled -and $timelineShapeDebug.Count -lt 6) {
                    $shapeType = Try-GetProp $effectShape 'Type'
                    $mediaType = Try-GetProp $effectShape 'MediaType'
                    $hasMedia = $mediaFormat -ne $null
                    $shapeName = Try-GetProp $effectShape 'Name'
                    $timelineShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
                  }
                  if ($mediaFormat) {
                    $timelineMediaCount += 1
                    if ($timelineMediaLengthRaw -eq $null) {
                      $timelineMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                    }
                    Add-MediaCandidate $effectShape
                  }
                }
              }
            }
          }
        } catch { }
        try {
          $layoutShapes = $targetSlide.CustomLayout.Shapes
          if ($layoutShapes) {
            $layoutShapeCount = $layoutShapes.Count
            for ($i = 1; $i -le $layoutShapes.Count; $i++) {
              $shape = $layoutShapes.Item($i)
              $mediaFormat = $null
              try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
              if ($debugEnabled -and $layoutShapeDebug.Count -lt 6) {
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $hasMedia = $mediaFormat -ne $null
                $shapeName = Try-GetProp $shape 'Name'
                $layoutShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
              }
              if ($mediaFormat) {
                $layoutMediaCount += 1
                if ($layoutMediaLengthRaw -eq $null) {
                  $layoutMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                }
              }
            }
            Collect-MediaShapes $layoutShapes
          }
        } catch { }
        try {
          $masterShapes = $targetSlide.Master.Shapes
          if ($masterShapes) {
            $masterShapeCount = $masterShapes.Count
            for ($i = 1; $i -le $masterShapes.Count; $i++) {
              $shape = $masterShapes.Item($i)
              $mediaFormat = $null
              try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
              if ($debugEnabled -and $masterShapeDebug.Count -lt 6) {
                $shapeType = Try-GetProp $shape 'Type'
                $mediaType = Try-GetProp $shape 'MediaType'
                $hasMedia = $mediaFormat -ne $null
                $shapeName = Try-GetProp $shape 'Name'
                $masterShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
              }
              if ($mediaFormat) {
                $masterMediaCount += 1
                if ($masterMediaLengthRaw -eq $null) {
                  $masterMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
                }
              }
            }
            Collect-MediaShapes $masterShapes
          }
        } catch { }
      }
    } catch {
      $slideMediaCount = $slideMediaCount
    }
    try {
      $viewSlide = $null
      try { $viewSlide = $ssWin.View.Slide } catch { $viewSlide = $null; $viewSlideError = $_.Exception.Message }
      if ($viewSlide) {
        try { $ssViewSlideShapeCount = $viewSlide.Shapes.Count } catch { $ssViewSlideShapeCount = $null; $ssViewSlideShapeError = $_.Exception.Message }
        $viewShapes = $null
        try { $viewShapes = $viewSlide.Shapes } catch { $viewShapes = $null; $viewShapesError = $_.Exception.Message }
        if ($viewShapes) {
          try { $viewSlideShapeCount = $viewShapes.Count } catch { $viewSlideShapeCount = 0; $viewShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $viewShapes.Count; $i++) {
            $shape = $viewShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $viewSlideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $viewSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $viewSlideMediaCount += 1
              if ($viewSlideMediaLengthRaw -eq $null) {
                $viewSlideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $viewShapes
        }
      }
    } catch {
      $viewSlideMediaCount = $viewSlideMediaCount
    }
    try {
      $editSlide = $null
      try { $editSlide = $ppt.ActiveWindow.View.Slide } catch { $editSlide = $null; $editSlideError = $_.Exception.Message }
      if ($editSlide) {
        $editShapes = $null
        try { $editShapes = $editSlide.Shapes } catch { $editShapes = $null; $editShapesError = $_.Exception.Message }
        if ($editShapes) {
          try { $editSlideShapeCount = $editShapes.Count } catch { $editSlideShapeCount = 0; $editShapesError = $_.Exception.Message }
          for ($i = 1; $i -le $editShapes.Count; $i++) {
            $shape = $editShapes.Item($i)
            $mediaFormat = $null
            try { $mediaFormat = $shape.MediaFormat } catch { $mediaFormat = $null }
            if ($debugEnabled -and $editSlideShapeDebug.Count -lt 6) {
              $shapeType = Try-GetProp $shape 'Type'
              $mediaType = Try-GetProp $shape 'MediaType'
              $hasMedia = $mediaFormat -ne $null
              $shapeName = Try-GetProp $shape 'Name'
              $editSlideShapeDebug += @{ name = $shapeName; type = $shapeType; mediaType = $mediaType; hasMedia = $hasMedia }
            }
            if ($mediaFormat) {
              $editSlideMediaCount += 1
              if ($editSlideMediaLengthRaw -eq $null) {
                $editSlideMediaLengthRaw = Try-GetProp $mediaFormat 'Length'
              }
            }
          }
          Collect-MediaShapes $editShapes
        }
      }
    } catch {
      $editSlideMediaCount = $editSlideMediaCount
    }
    $candidateCount = $mediaCandidates.Count
    foreach ($shape in $mediaCandidates) {
      if ($videoDurationMs -eq $null) {
        try {
          $mediaFormat = $shape.MediaFormat
          $length = Try-GetProp $mediaFormat 'Length'
          $videoDurationMs = Convert-ToMs $length
        } catch { }
      }
      try {
        $shapeId = Try-GetProp $shape 'Id'
        if ($shapeId -ne $null) {
          $viewPlayer = $ppt.SlideShowWindows.Item(1).View.Player($shapeId)
          if ($viewPlayer) {
            $playerSource = 'SlideShowView.Player(shapeId)'
            $state = Try-GetProp $viewPlayer 'State'
            $pos = Try-GetProp $viewPlayer 'CurrentPosition'
            if ($pos -ne $null) {
              $videoElapsedMs = Convert-ToMs $pos
            }
            if ($state -ne $null) {
              if ($state -eq 2) { $videoPlaying = $true }
              elseif ($state -eq 1) { $videoPlaying = $false }
            }
          }
        }
      } catch { }
      if ($videoDurationMs -ne $null -or $videoElapsedMs -ne $null) { break }
    }
    if ($videoDurationMs -eq $null -and $slideMediaLengthRaw -ne $null) {
      $videoDurationMs = Convert-ToMs $slideMediaLengthRaw
    }
  } catch {
    $videoPlaying = $null
  }
  if (
    $player -ne $null -and
    $videoDurationMs -eq $null -and
    $videoElapsedMs -eq $null -and
    $candidateCount -eq 0 -and
    $slideShapeCount -eq 0 -and
    $viewSlideShapeCount -eq 0 -and
    $editSlideShapeCount -eq 0
  ) {
    $videoTimingUnavailable = $true
  }
} else {
  try { $slideIndex = $ppt.ActiveWindow.View.Slide.SlideIndex } catch { $slideIndex = $null }
}
$totalSlides = $null
try { $totalSlides = $presentation.Slides.Count } catch { $totalSlides = $null }
$title = $presentation.Name
$filename = $presentation.FullName
$payload = @{
  state = 'foreground'
  inSlideshow = $inSlideshow
  instanceId = $targetPid
  slideNumber = $slideIndex
  totalSlides = $totalSlides
  title = $title
  filename = $filename
}
if ($debugEnabled) {
  $payload.debug = @{
    playerFound = [bool]$player
    playerSource = $playerSource
    durationRaw = $duration
    elapsedRaw = $elapsed
    stateRaw = $state
    mediaShapeCount = $mediaShapeCount
    mediaLengthRaw = $mediaLengthRaw
    slideMediaCount = $slideMediaCount
    slideMediaLengthRaw = $slideMediaLengthRaw
    slideShapeCount = $slideShapeCount
    slideShapeDebug = $slideShapeDebug
    viewSlideShapeCount = $viewSlideShapeCount
    viewSlideMediaCount = $viewSlideMediaCount
    viewSlideMediaLengthRaw = $viewSlideMediaLengthRaw
    viewSlideShapeDebug = $viewSlideShapeDebug
    candidateCount = $candidateCount
    protectedViewCount = $protectedViewCount
    ssWinCount = $ssWinCount
    ssWinFound = $ssWinFound
    ssViewFound = $ssViewFound
    ssShowPositionRaw = $ssShowPositionRaw
    ssWinError = $ssWinError
    ssViewError = $ssViewError
    ssPresentationError = $ssPresentationError
    slideIndexError = $slideIndexError
    targetSlideError = $targetSlideError
    slideShapesError = $slideShapesError
    viewSlideError = $viewSlideError
    viewShapesError = $viewShapesError
    editSlideError = $editSlideError
    editShapesError = $editShapesError
    activePresentationName = $activePresentationName
    activePresentationFullName = $activePresentationFullName
    ssPresentationName = $ssPresentationName
    ssPresentationFullName = $ssPresentationFullName
    presentationPath = $presentationPath
    presentationSaved = $presentationSaved
    presentationReadOnly = $presentationReadOnly
    presentationSlidesCount = $presentationSlidesCount
    editSlideShapeCount = $editSlideShapeCount
    editSlideMediaCount = $editSlideMediaCount
    editSlideMediaLengthRaw = $editSlideMediaLengthRaw
    editSlideShapeDebug = $editSlideShapeDebug
    layoutShapeCount = $layoutShapeCount
    layoutMediaCount = $layoutMediaCount
    layoutMediaLengthRaw = $layoutMediaLengthRaw
    layoutShapeDebug = $layoutShapeDebug
    masterShapeCount = $masterShapeCount
    masterMediaCount = $masterMediaCount
    masterMediaLengthRaw = $masterMediaLengthRaw
    masterShapeDebug = $masterShapeDebug
    timelineEffectCount = $timelineEffectCount
    timelineMediaCount = $timelineMediaCount
    timelineMediaLengthRaw = $timelineMediaLengthRaw
    timelineShapeDebug = $timelineShapeDebug
    activeSlideShapeCount = $activeSlideShapeCount
    ssPresentationSlideShapeCount = $ssPresentationSlideShapeCount
    ssViewSlideShapeCount = $ssViewSlideShapeCount
    activeSlideShapeError = $activeSlideShapeError
    ssPresentationSlideShapeError = $ssPresentationSlideShapeError
    ssViewSlideShapeError = $ssViewSlideShapeError
    ssPresentationSlideShapeDebug = $ssPresentationSlideShapeDebug
    apartmentState = $apartmentState
    apartmentStateName = $apartmentStateName
    runspaceApartment = $runspaceApartment
    psVersion = $psVersion
    psHostName = $psHostName
    pptVersion = $pptVersion
    pptBuild = $pptBuild
  }
}
if ($videoPlaying -ne $null) { $payload.videoPlaying = $videoPlaying }
if ($videoDurationMs -ne $null) { $payload.videoDuration = $videoDurationMs }
if ($videoElapsedMs -ne $null) { $payload.videoElapsed = $videoElapsedMs }
if ($videoRemainingMs -ne $null) { $payload.videoRemaining = $videoRemainingMs }
if ($videoTimingUnavailable) { $payload.videoTimingUnavailable = $true }
$payload | ConvertTo-Json -Compress
`.trim();

  const helperResult = await pollPowerPointViaHelper(script);
  if (helperResult) {
    return helperResult;
  }

  return await new Promise((resolve) => {
    const powershellPath = path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    const child = spawn(
      powershellPath,
      ['-STA', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      if (pptDebugEnabled) {
        console.warn('[ppt] PowerShell timeout');
      }
      resolve(null);
    }, 8000);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        console.warn(`[ppt] PowerShell failed (code=${code}): ${stderr.trim()}`);
        resolve(null);
        return;
      }
      const raw = stdout.trim();
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw) as PowerPointPollResult);
      } catch (error) {
        console.warn(`[ppt] Failed to parse PowerShell output: ${String(error)}`);
        resolve(null);
      }
    });
  });
}

function handlePowerPointStatus(result: PowerPointPollResult | null) {
  if (!result) {
    logPptVerbose('[ppt] status: null');
    return;
  }

  logPptVerbose('[ppt] status', result);

  const now = Date.now();
  if (result.state === 'foreground' || result.state === 'background') {
    if (result.state === 'foreground') {
      pptBackgroundSince = null;
    } else {
      if (pptBackgroundSince === null) {
        pptBackgroundSince = now;
      }
    }
    if (!result.instanceId) {
      return;
    }
    if (result.inSlideshow === false) {
      if (pptAnnouncedSnapshot) {
        updatePresentationCandidate(null);
      }
      return;
    }
    const title = result.title?.trim() || result.filename?.trim() || 'PowerPoint';
    const lastSlideNumber =
      pptAnnouncedSnapshot?.instanceId === result.instanceId ? pptAnnouncedSnapshot.slideNumber : undefined;
    const resolvedSlideNumber = result.slideNumber ?? lastSlideNumber;
    const slideKey = `${result.instanceId}:${resolvedSlideNumber ?? 'unknown'}`;
    const slideChanged =
      pptAnnouncedSnapshot?.instanceId === result.instanceId &&
      pptAnnouncedSnapshot.slideNumber !== resolvedSlideNumber;
    const explicitNoVideo =
      result.videoDetected === false &&
      result.videoDuration === undefined &&
      result.videoElapsed === undefined &&
      result.videoRemaining === undefined &&
      (!result.videos || result.videos.length === 0) &&
      (!result.editSlideVideos || result.editSlideVideos.length === 0);
    let videos = result.videos && result.videos.length > 0 ? result.videos : undefined;
    if (!videos && result.editSlideVideos && result.editSlideVideos.length > 0) {
      videos = result.editSlideVideos;
    }
    if (!videos && !explicitNoVideo) {
      const cached = pptVideoCache.get(slideKey);
      if (cached) {
        videos = cached;
      }
    }
    logPptVerbose('[ppt] cache probe', {
      slideKey,
      slideNumber: resolvedSlideNumber,
      slideChanged,
      explicitNoVideo,
      hasVideos: videos?.length ?? 0,
      cachedVideos: pptVideoCache.get(slideKey)?.length ?? 0,
      resultVideos: result.videos?.length ?? 0,
      editVideos: result.editSlideVideos?.length ?? 0,
      videoDetected: result.videoDetected,
      videoDuration: result.videoDuration,
      videoElapsed: result.videoElapsed,
      videoRemaining: result.videoRemaining,
    });
    const hasVideoPayload =
      !explicitNoVideo &&
      (result.videoDetected === true ||
        (videos && videos.length > 0) ||
        result.videoDuration !== undefined ||
        result.videoElapsed !== undefined ||
        result.videoRemaining !== undefined ||
        result.videoPlaying !== undefined);
    if (!hasVideoPayload) {
      if (pptNoVideoKey === slideKey) {
        pptNoVideoCount += 1;
      } else {
        pptNoVideoKey = slideKey;
        pptNoVideoCount = 1;
      }
    } else {
      pptNoVideoKey = null;
      pptNoVideoCount = 0;
    }
    if (explicitNoVideo) {
      if (pptExplicitNoVideoKey === slideKey) {
        pptExplicitNoVideoCount += 1;
      } else {
        pptExplicitNoVideoKey = slideKey;
        pptExplicitNoVideoCount = 1;
      }
    } else {
      pptExplicitNoVideoKey = null;
      pptExplicitNoVideoCount = 0;
    }
    if (slideChanged) {
      pptNoVideoKey = slideKey;
      pptNoVideoCount = explicitNoVideo ? PPT_VIDEO_CLEAR_POLLS : 0;
      pptExplicitNoVideoKey = slideKey;
      pptExplicitNoVideoCount = explicitNoVideo ? PPT_VIDEO_CLEAR_POLLS : 0;
    }
    const shouldClearVideo =
      (slideChanged && explicitNoVideo) ||
      (!hasVideoPayload && pptNoVideoCount >= PPT_VIDEO_CLEAR_POLLS);
    const shouldClearExplicit =
      explicitNoVideo && pptExplicitNoVideoCount >= PPT_VIDEO_CLEAR_POLLS;
    if (shouldClearVideo || shouldClearExplicit) {
      pptVideoCache.delete(slideKey);
      videos = undefined;
      logPptVerbose('[ppt] cache cleared', {
        slideKey,
        shouldClearVideo,
        shouldClearExplicit,
        pptNoVideoCount,
        pptExplicitNoVideoCount,
      });
    }
    const priorSnapshot =
      pptAnnouncedSnapshot?.instanceId === result.instanceId &&
        pptAnnouncedSnapshot.slideNumber === resolvedSlideNumber
        ? pptAnnouncedSnapshot
        : null;
    const videoDetected = hasVideoPayload && !shouldClearVideo;
    const canReuseVideo = videoDetected && priorSnapshot !== null;
    if (videos && videoDetected) {
      if (priorSnapshot?.videos && priorSnapshot.videos.length > 0) {
        let hasDelta = false;
        videos = videos.map((video, index) => {
          const prior =
            priorSnapshot.videos?.find((entry) => entry.id !== undefined && entry.id === video.id) ??
            priorSnapshot.videos?.find((entry) => entry.name && entry.name === video.name) ??
            priorSnapshot.videos?.[index];
          const currentElapsed = video.elapsed ?? null;
          const priorElapsed = prior?.elapsed ?? null;
          const delta =
            currentElapsed !== null && priorElapsed !== null ? currentElapsed - priorElapsed : null;
          if (delta !== null && delta > 200) {
            hasDelta = true;
            return { ...video, playing: true };
          }
          return video;
        });
        if (hasDelta) {
          videos = videos.map((video) =>
            video.playing ? video : { ...video, playing: false }
          );
        }
      }
      pptVideoCache.set(slideKey, videos);
    }
    // Calculate resolvedVideos AFTER enrichment so we get the enriched array
    const resolvedVideos =
      shouldClearVideo || shouldClearExplicit
        ? undefined
        : videos ?? priorSnapshot?.videos;
    const lastVideoDuration = priorSnapshot?.videoDuration;
    const lastVideoElapsed = priorSnapshot?.videoElapsed;
    const lastVideoRemaining = priorSnapshot?.videoRemaining;
    const lastVideoPlaying = priorSnapshot?.videoPlaying;
    const snapshot: PresentationSnapshot = {
      instanceId: result.instanceId,
      slideNumber: resolvedSlideNumber,
      totalSlides: result.totalSlides,
      title,
      filename: result.filename,
      videoPlaying: videoDetected ? result.videoPlaying ?? lastVideoPlaying : undefined,
      videoDuration: videoDetected ? result.videoDuration ?? lastVideoDuration : undefined,
      videoElapsed: videoDetected ? result.videoElapsed ?? lastVideoElapsed : undefined,
      videoRemaining: videoDetected ? result.videoRemaining ?? lastVideoRemaining : undefined,
      videos: resolvedVideos,
      videoTimingUnavailable:
        videoDetected && (result.videoTimingUnavailable === true && (!resolvedVideos || resolvedVideos.length === 0)),
      permissions: result.permissions
    };
    updatePresentationCandidate(snapshot);
    return;
  }

  pptBackgroundSince = null;
  updatePresentationCandidate(null);
}

function startPowerPointDetection() {
  if (process.platform === 'darwin') {
    const isAppTrusted = systemPreferences.isTrustedAccessibilityClient(false);
    logPptInfo(`[ppt] Startup - App Accessibility Trust: ${isAppTrusted}`);
    void appendPptLog(`[ppt] Startup - App Accessibility Trust: ${isAppTrusted}`);
  }
  if (pptPollTimer) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    if (pptDebugEnabled) {
      logPptInfo('[ppt] detection disabled: unsupported platform')
    }
    return;
  }
  if (!getCompanionCapabilities().powerpoint) {
    if (pptDebugEnabled) {
      logPptInfo('[ppt] detection disabled: capability false')
    }
    return;
  }

  if (pptDebugEnabled) {
    logPptInfo('[ppt] detection started', { platform: process.platform })
  }
  void appendPptLog(`[ppt] detection start mode=${currentCompanionMode} caps=${JSON.stringify(getCompanionCapabilities())}`);

  if (process.platform === 'darwin') {
    pptProbeManager.start();
  }

  pptPollTimer = setInterval(() => {
    if (pptPollInFlight) return;
    pptPollInFlight = true;
    fetchPowerPointStatus()
      .then((result) => handlePowerPointStatus(result))
      .finally(() => {
        pptPollInFlight = false;
      });
  }, PPT_POLL_INTERVAL_MS);
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
    companionMode: currentCompanionMode,
    companionVersion: COMPANION_VERSION,
    interfaceVersion: INTERFACE_VERSION,
    capabilities: getCompanionCapabilities(),
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

  // Send current live cues (including PPT cue with videos) so client has full state
  const roomCues = getRoomLiveCues(payload.roomId);
  roomCues.forEach(({ cue, updatedAt }) => {
    const cuePayload: LiveCueEventPayload = {
      type: 'LIVE_CUE_UPDATED',
      roomId: payload.roomId,
      cue,
      timestamp: updatedAt,
    };
    console.log(`[ws] LIVE_CUE_UPDATED replay room=${payload.roomId} cue=${cue.id}`);
    socket.emit('LIVE_CUE_UPDATED', cuePayload);
    if (cue.source === 'powerpoint') {
      const presentationPayload: PresentationEventPayload = {
        type: 'PRESENTATION_UPDATE',
        roomId: payload.roomId,
        cue,
        timestamp: updatedAt,
      };
      console.log(`[ws] PRESENTATION_UPDATE replay room=${payload.roomId} cue=${cue.id}`);
      socket.emit('PRESENTATION_UPDATE', presentationPayload);
    }
  });

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
  if (!isSocketActive(target.socketId)) {
    clients.delete(targetClientId);
    emitRoomClientsState(roomId);
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
    lastUpdate: Date.now(),
    activeLiveCueId: undefined,
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

      if (url.pathname === '/api/status-window') {
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
          if (!isHeadlessMode()) {
            showStatusWindow(token, expiresAt);
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Private-Network': 'true'
          });
          res.end(JSON.stringify({ success: true, headless: isHeadlessMode() }));
          return;
        }
      }

      if (url.pathname === '/api/open' && req.method === 'OPTIONS') {
        const cors = authorizeCorsOnly(req);
        if (!cors.ok) {
          sendUnauthorized(res);
          return;
        }
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, cors.origin);
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
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, auth.origin);
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

            const resolved = await validateExistingUserFile(inputPath);
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

      if (url.pathname === '/api/file/exists' && req.method === 'OPTIONS') {
        const cors = authorizeCorsOnly(req);
        if (!cors.ok) {
          sendUnauthorized(res);
          return;
        }
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, cors.origin);
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

      if (url.pathname === '/api/file/exists' && req.method === 'GET') {
        const auth = authorizeRequest(req);
        if (!auth.ok) {
          sendUnauthorized(res, auth.origin);
          return;
        }
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, auth.origin);
          return;
        }

        const inputPath = url.searchParams.get('path');
        if (!inputPath) {
          sendInvalidPath(res, auth.origin);
          return;
        }

        void (async () => {
          try {
            const resolved = await validatePotentialUserFile(inputPath);
            if (!resolved) {
              sendInvalidPath(res, auth.origin);
              console.warn(
                `[file] exists denied caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(inputPath)}`
              );
              return;
            }

            let exists = false;
            try {
              const stat = await fs.stat(resolved);
              exists = stat.isFile();
            } catch (error: any) {
              if (error?.code !== 'ENOENT') {
                sendInvalidPath(res, auth.origin);
                return;
              }
            }

            sendJson(res, 200, { exists }, auth.origin);
            console.log(
              `[file] exists ok caller=${auth.clientId ?? 'unknown'} file=${getRedactedPath(resolved)} exists=${exists}`
            );
          } catch (error) {
            console.warn(
              `[file] exists failed caller=${auth.clientId ?? 'unknown'} error=${String(error)}`
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
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, cors.origin);
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
        if (!getCompanionCapabilities().fileOperations) {
          sendFeatureUnavailable(res, auth.origin);
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
            const resolved = await validateExistingUserFile(inputPath);
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
