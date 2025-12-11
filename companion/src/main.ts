import { app, Menu, Tray, nativeImage } from 'electron';
import { createServer, Server as HttpServer } from 'node:http';
import os from 'node:os';
import { Server as SocketIOServer, Socket } from 'socket.io';

let tray: Tray | null = null;

const APP_LABEL = 'OnTime Companion';
const MODE_LABEL = 'Minimal Mode';
const COMPANION_MODE = 'minimal';
const COMPANION_VERSION = '0.1.0';

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
  timestamp: number;
};

let io: SocketIOServer | null = null;
let httpServer: HttpServer | null = null;
const roomStateStore: Map<string, RoomState> = new Map();

function generatePin(): string {
  const pin = Math.floor(Math.random() * 1_000_000);
  return pin.toString().padStart(6, '0');
}

function createTray(pin: string) {
  const icon = nativeImage.createFromBuffer(getTrayPng());
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip(`${APP_LABEL} - ${MODE_LABEL}`);

  const contextMenu = Menu.buildFromTemplate([
    { label: `${APP_LABEL} - ${MODE_LABEL}`, enabled: false },
    { type: 'separator' },
    { label: `PIN: ${pin}`, enabled: false },
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

  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  const pin = generatePin();
  console.log(`Companion PIN: ${pin}`);

  createTray(pin);
  startSocketServer(pin);
}

bootstrap().catch((error) => {
  console.error('Failed to launch Companion:', error);
  app.quit();
});

function startSocketServer(pin: string) {
  httpServer = createServer();
  io = new SocketIOServer(httpServer, {
    serveClient: false,
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  io.on('connection', (socket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    socket.on('JOIN_ROOM', (payload) => handleJoinRoom(socket, payload, pin));
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
  });
}

function handleJoinRoom(socket: Socket, payload: unknown, pin: string) {
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

  if (payload.token !== pin) {
    console.warn(
      `[ws] Invalid PIN from socket=${socket.id}, room=${payload.roomId ?? 'unknown'}`
    );
    const error: HandshakeError = {
      type: 'HANDSHAKE_ERROR',
      code: 'INVALID_TOKEN',
      message: 'Invalid PIN. Please check the Companion app system tray.'
    };
    socket.emit('HANDSHAKE_ERROR', error);
    socket.disconnect(true);
    return;
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
    typeof data.token === 'string' &&
    /^\d{6}$/.test(data.token)
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

  const delta: RoomStateDelta = {
    type: 'ROOM_STATE_DELTA',
    roomId: payload.roomId,
    changes,
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
  return initial;
}
