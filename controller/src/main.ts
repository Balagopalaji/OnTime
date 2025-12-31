import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import http from 'node:http';

let staticServer: http.Server | null = null;
let staticServerPort: number | null = null;

const APP_LABEL = 'OnTime Controller';
const PROTOCOL_SCHEME = 'ontime';

// State for window management
let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

// Development mode detection
const isDev = !app.isPackaged;

// Auto-updater configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoRunAppAfterInstall = true;

// Update state
type UpdateState = {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  version: string | null;
  error: string | null;
};

let updateState: UpdateState = {
  checking: false,
  available: false,
  downloaded: false,
  downloading: false,
  progress: 0,
  version: null,
  error: null,
};

// Window state persistence
type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OnTime', 'controller');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'OnTime', 'controller');
  }
  return path.join(os.homedir(), '.config', 'ontime', 'controller');
}

function getWindowStatePath(): string {
  return path.join(getConfigDir(), 'window-state.json');
}

function getSessionStatePath(): string {
  return path.join(getConfigDir(), 'session-state.json');
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function loadWindowState(): Promise<WindowState> {
  const defaultState: WindowState = { width: 1200, height: 800 };
  try {
    const statePath = getWindowStatePath();
    const data = await fs.readFile(statePath, 'utf-8');
    const state = JSON.parse(data) as WindowState;
    return {
      width: state.width || defaultState.width,
      height: state.height || defaultState.height,
      x: state.x,
      y: state.y,
      maximized: state.maximized,
    };
  } catch {
    return defaultState;
  }
}

async function saveWindowState(win: BrowserWindow): Promise<void> {
  try {
    const bounds = win.getBounds();
    const maximized = win.isMaximized();
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized,
    };
    const statePath = getWindowStatePath();
    await ensureDir(statePath);
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[controller] Failed to save window state:', err);
  }
}

// Session state for crash recovery
type SessionState = {
  lastPath: string | null;
  lastRoomId: string | null;
  closedCleanly: boolean;
  timestamp: number;
};

async function loadSessionState(): Promise<SessionState | null> {
  try {
    const statePath = getSessionStatePath();
    const data = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(data) as SessionState;
  } catch {
    return null;
  }
}

async function saveSessionState(state: Partial<SessionState>): Promise<void> {
  try {
    const statePath = getSessionStatePath();
    await ensureDir(statePath);
    let existing: SessionState = {
      lastPath: null,
      lastRoomId: null,
      closedCleanly: false,
      timestamp: Date.now(),
    };
    try {
      const data = await fs.readFile(statePath, 'utf-8');
      existing = JSON.parse(data) as SessionState;
    } catch {
      // No existing state
    }
    const updated = { ...existing, ...state, timestamp: Date.now() };
    await fs.writeFile(statePath, JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error('[controller] Failed to save session state:', err);
  }
}

// Synchronous version for critical startup writes (crash recovery flag)
function saveSessionStateSync(state: Partial<SessionState>): void {
  try {
    const statePath = getSessionStatePath();
    fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
    let existing: SessionState = {
      lastPath: null,
      lastRoomId: null,
      closedCleanly: false,
      timestamp: Date.now(),
    };
    try {
      const data = fsSync.readFileSync(statePath, 'utf-8');
      existing = JSON.parse(data) as SessionState;
    } catch {
      // No existing state
    }
    const updated = { ...existing, ...state, timestamp: Date.now() };
    fsSync.writeFileSync(statePath, JSON.stringify(updated, null, 2));
  } catch (err) {
    console.error('[controller] Failed to save session state (sync):', err);
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html';
    case '.js':
      return 'text/javascript';
    case '.css':
      return 'text/css';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

async function startStaticServer(): Promise<string> {
  if (staticServer && staticServerPort) {
    return `http://localhost:${staticServerPort}`;
  }

  const rootDir = path.join(process.resourcesPath, 'frontend');
  staticServer = http.createServer(async (req, res) => {
    try {
      const url = req.url ? decodeURIComponent(req.url.split('?')[0]) : '/';
      const safePath = url === '/' ? '/index.html' : url;
      const filePath = path.join(rootDir, safePath);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      let toServe = resolved;
      try {
        const stat = await fs.stat(toServe);
        if (stat.isDirectory()) {
          toServe = path.join(toServe, 'index.html');
        }
      } catch {
        // Fallback to index.html for SPA routes
        toServe = path.join(rootDir, 'index.html');
      }

      const data = await fs.readFile(toServe);
      res.writeHead(200, { 'Content-Type': getMimeType(toServe) });
      res.end(data);
    } catch (err) {
      console.error('[controller] Static server error', err);
      res.writeHead(500);
      res.end('Server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    staticServer?.once('error', reject);
    staticServer?.listen(0, '127.0.0.1', () => {
      const address = staticServer?.address();
      if (address && typeof address === 'object') {
        staticServerPort = address.port;
      }
      resolve();
    });
  });

  return `http://localhost:${staticServerPort}`;
}

async function getFrontendPath(): Promise<string> {
  if (isDev) {
    // In dev mode, load from the frontend dev server
    return 'http://localhost:5173';
  }
  return startStaticServer();
}

function parseDeepLink(url: string): { roomId: string | null; action: string | null } {
  // Parse ontime://room/:roomId format
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) {
      return { roomId: null, action: null };
    }
    // Handle ontime://room/:roomId or ontime://room/:roomId/control
    const pathParts = parsed.pathname.replace(/^\/+/, '').split('/');
    if (pathParts[0] === 'room' && pathParts[1]) {
      return {
        roomId: pathParts[1],
        action: pathParts[2] || 'control',
      };
    }
    return { roomId: null, action: null };
  } catch {
    return { roomId: null, action: null };
  }
}

async function navigateToDeepLink(win: BrowserWindow, url: string): Promise<void> {
  const { roomId, action } = parseDeepLink(url);
  if (roomId) {
    const route = `/room/${roomId}/${action || 'control'}`;
    // Send navigation request to renderer
    win.webContents.send('navigate', route);
  }
}

async function createWindow(): Promise<BrowserWindow> {
  const windowState = await loadWindowState();
  const sessionState = await loadSessionState();

  // Check for crash recovery
  const needsCrashRecovery = sessionState && !sessionState.closedCleanly && sessionState.lastPath;

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    title: APP_LABEL,
    backgroundColor: '#0f172a', // slate-950
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (windowState.maximized) {
    mainWindow.maximize();
  }

  // Load the frontend
  const frontendPath = await getFrontendPath();
  if (isDev) {
    await mainWindow.loadURL(frontendPath);
    // Open devtools in dev mode
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadURL(frontendPath);
  }

  // Handle crash recovery after page loads
  if (needsCrashRecovery && sessionState) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('crash-recovery', {
        lastPath: sessionState.lastPath,
        lastRoomId: sessionState.lastRoomId,
        timestamp: sessionState.timestamp,
      });
    });
  }

  // Handle pending deep link
  if (pendingDeepLink) {
    mainWindow.webContents.once('did-finish-load', () => {
      if (pendingDeepLink && mainWindow) {
        void navigateToDeepLink(mainWindow, pendingDeepLink);
        pendingDeepLink = null;
      }
    });
  }

  // Mark session as not cleanly closed (sync to ensure it's written before any crash)
  saveSessionStateSync({ closedCleanly: false });

  // Save window state on resize/move
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      void saveWindowState(mainWindow);
    }
  });

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      void saveWindowState(mainWindow);
    }
  });

  mainWindow.on('maximize', () => {
    if (mainWindow) {
      void saveWindowState(mainWindow);
    }
  });

  mainWindow.on('unmaximize', () => {
    if (mainWindow) {
      void saveWindowState(mainWindow);
    }
  });

  // Handle external links and auth popups
  const isAuthPopupUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'accounts.google.com' ||
        hostname.endsWith('.firebaseapp.com') ||
        hostname.endsWith('.web.app')
      );
    } catch {
      return false;
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (isAuthPopupUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: mainWindow ?? undefined,
            modal: true,
            width: 520,
            height: 640,
            resizable: true,
            backgroundColor: '#0f172a',
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

// IPC handlers
function setupIpcHandlers(): void {
  // Get platform info
  ipcMain.handle('get-platform-info', () => ({
    isElectron: true,
    platform: process.platform,
    version: app.getVersion(),
    isDev,
  }));

  // Update session state from renderer
  ipcMain.handle('update-session-state', async (_event, state: { lastPath?: string; lastRoomId?: string }) => {
    await saveSessionState(state);
    return true;
  });

  // Acknowledge crash recovery
  ipcMain.handle('ack-crash-recovery', async () => {
    await saveSessionState({ closedCleanly: true });
    return true;
  });

  // Open external URL
  ipcMain.handle('open-external', async (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Auto-update IPC handlers
  ipcMain.handle('get-update-state', () => updateState);

  ipcMain.handle('check-for-updates', async () => {
    if (isDev) {
      return { available: false, reason: 'dev-mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return { available: result?.updateInfo != null, version: result?.updateInfo?.version };
    } catch (err) {
      console.error('[updater] Check failed:', err);
      return { available: false, error: String(err) };
    }
  });

  ipcMain.handle('download-update', async () => {
    if (!updateState.available || updateState.downloading) {
      return false;
    }
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      console.error('[updater] Download failed:', err);
      return false;
    }
  });

  ipcMain.handle('install-update', () => {
    if (updateState.downloaded) {
      autoUpdater.quitAndInstall(false, true);
      return true;
    }
    return false;
  });
}

// Send update state to renderer
function sendUpdateState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-state-changed', updateState);
  }
}

// Setup auto-updater event handlers
function setupAutoUpdater(): void {
  if (isDev) {
    console.log('[updater] Skipping auto-updater in dev mode');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
    updateState = { ...updateState, checking: true, error: null };
    sendUpdateState();
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[updater] Update available:', info.version);
    updateState = {
      ...updateState,
      checking: false,
      available: true,
      version: info.version,
    };
    sendUpdateState();
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No update available');
    updateState = { ...updateState, checking: false, available: false };
    sendUpdateState();
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateState = {
      ...updateState,
      downloading: true,
      progress: progress.percent,
    };
    sendUpdateState();
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[updater] Update downloaded:', info.version);
    updateState = {
      ...updateState,
      downloading: false,
      downloaded: true,
      progress: 100,
    };
    sendUpdateState();
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] Error:', err);
    updateState = {
      ...updateState,
      checking: false,
      downloading: false,
      error: err.message,
    };
    sendUpdateState();
  });

  // Check for updates after startup (with delay)
  setTimeout(() => {
    console.log('[updater] Running initial update check...');
    void autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Initial check failed:', err);
    });
  }, 5000);
}

// Handle deep links on macOS
function handleOpenUrl(url: string): void {
  if (mainWindow) {
    void navigateToDeepLink(mainWindow, url);
  } else {
    pendingDeepLink = url;
  }
}

// Main startup
async function main(): Promise<void> {
  // Single instance lock
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  // Handle second instance (another app launch with deep link)
  app.on('second-instance', (_event, commandLine) => {
    // Focus existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    // Handle deep link from command line (Windows/Linux)
    const deepLink = commandLine.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    if (deepLink) {
      handleOpenUrl(deepLink);
    }
  });

  // Handle open-url event (macOS)
  app.on('open-url', (_event, url) => {
    handleOpenUrl(url);
  });

  app.on('window-all-closed', () => {
    // On macOS, apps typically stay open until explicitly quit
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (mainWindow === null) {
      void createWindow();
    }
  });

  // Handle clean shutdown
  app.on('before-quit', () => {
    void saveSessionState({ closedCleanly: true });
  });

  await app.whenReady();

  // Register deep link protocol
  if (!app.isDefaultProtocolClient(PROTOCOL_SCHEME)) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
  }

  // Register custom protocol for loading local files in production
  if (!isDev) {
    protocol.registerFileProtocol('app', (request, callback) => {
      const url = request.url.replace('app://', '');
      const filePath = path.join(process.resourcesPath, 'frontend', url);
      callback({ path: filePath });
    });
  }

  // Setup IPC handlers
  setupIpcHandlers();

  // Setup auto-updater
  setupAutoUpdater();

  // Handle deep link from command line on initial launch (Windows/Linux)
  const deepLink = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
  if (deepLink) {
    pendingDeepLink = deepLink;
  }

  // Create the main window
  await createWindow();

  console.log(`[controller] ${APP_LABEL} started`);
}

main().catch((err) => {
  console.error('[controller] Failed to start:', err);
  app.quit();
});
