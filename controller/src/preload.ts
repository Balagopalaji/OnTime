import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposed APIs for the renderer process via contextBridge.
 * All methods are async and safe to call from the React app.
 */

export type PlatformInfo = {
  isElectron: true;
  platform: NodeJS.Platform;
  version: string;
  isDev: boolean;
};

export type CrashRecoveryData = {
  lastPath: string | null;
  lastRoomId: string | null;
  timestamp: number;
};

export type UpdateState = {
  checking: boolean;
  available: boolean;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  version: string | null;
  error: string | null;
};

export type ControllerPortPreference = {
  preferredPort: number | null;
  activePort: number | null;
  source: 'env' | 'saved' | 'default' | 'random';
  envOverride: boolean;
};

export type ControllerAPI = {
  // Platform detection
  getPlatformInfo: () => Promise<PlatformInfo>;

  // Session state management
  updateSessionState: (state: { lastPath?: string; lastRoomId?: string }) => Promise<boolean>;
  ackCrashRecovery: () => Promise<boolean>;

  // External URLs
  openExternal: (url: string) => Promise<boolean>;

  // Navigation events (from main process)
  onNavigate: (callback: (route: string) => void) => () => void;

  // Crash recovery events
  onCrashRecovery: (callback: (data: CrashRecoveryData) => void) => () => void;

  // Auto-update
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdates: () => Promise<{ available: boolean; version?: string; error?: string; reason?: string }>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<boolean>;
  onUpdateStateChanged: (callback: (state: UpdateState) => void) => () => void;

  // Controller port preference (Enterprise)
  getControllerPortPreference: () => Promise<ControllerPortPreference>;
  setControllerPortPreference: (preferredPort: number | null) => Promise<{ preferredPort: number | null }>;
};

// Create the API object
const controllerAPI: ControllerAPI = {
  // Get platform information
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),

  // Update session state (for crash recovery)
  updateSessionState: (state) => ipcRenderer.invoke('update-session-state', state),

  // Acknowledge crash recovery (mark session as recovered)
  ackCrashRecovery: () => ipcRenderer.invoke('ack-crash-recovery'),

  // Open external URL in default browser
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Listen for navigation events from main process (deep links)
  onNavigate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, route: string) => {
      callback(route);
    };
    ipcRenderer.on('navigate', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('navigate', handler);
    };
  },

  // Listen for crash recovery events
  onCrashRecovery: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CrashRecoveryData) => {
      callback(data);
    };
    ipcRenderer.on('crash-recovery', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('crash-recovery', handler);
    };
  },

  // Get current update state
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),

  // Check for updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Download available update
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  // Install downloaded update and restart
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Listen for update state changes
  onUpdateStateChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => {
      callback(state);
    };
    ipcRenderer.on('update-state-changed', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('update-state-changed', handler);
    };
  },

  // Read controller port preference
  getControllerPortPreference: () => ipcRenderer.invoke('get-controller-port-preference'),

  // Update controller port preference
  setControllerPortPreference: (preferredPort) =>
    ipcRenderer.invoke('set-controller-port-preference', preferredPort),
};

// Expose to renderer via contextBridge
contextBridge.exposeInMainWorld('controllerAPI', controllerAPI);

// Type declaration for the exposed API
declare global {
  interface Window {
    controllerAPI?: ControllerAPI;
  }
}
