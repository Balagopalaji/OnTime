/**
 * Electron integration utilities.
 * Provides safe access to the controller API exposed via contextBridge.
 */

export type PlatformInfo = {
  isElectron: true;
  platform: string;
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
  getPlatformInfo: () => Promise<PlatformInfo>;
  updateSessionState: (state: { lastPath?: string; lastRoomId?: string }) => Promise<boolean>;
  ackCrashRecovery: () => Promise<boolean>;
  openExternal: (url: string) => Promise<boolean>;
  onNavigate: (callback: (route: string) => void) => () => void;
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

declare global {
  interface Window {
    controllerAPI?: ControllerAPI;
  }
}

/**
 * Check if running inside the Electron controller app.
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.controllerAPI);
}

/**
 * Get the controller API if available.
 * Returns null if not running in Electron.
 */
export function getControllerAPI(): ControllerAPI | null {
  if (typeof window === 'undefined') return null;
  return window.controllerAPI ?? null;
}

/**
 * Update session state for crash recovery.
 * Call this when navigation changes to persist the current path.
 */
export async function updateSessionState(state: { lastPath?: string; lastRoomId?: string | undefined }): Promise<void> {
  const api = getControllerAPI();
  if (api) {
    try {
      await api.updateSessionState(state);
    } catch (err) {
      console.error('[electron] Failed to update session state:', err);
    }
  }
}

/**
 * Acknowledge crash recovery (mark session as recovered).
 * Call this when the user dismisses the recovery banner.
 */
export async function ackCrashRecovery(): Promise<void> {
  const api = getControllerAPI();
  if (api) {
    try {
      await api.ackCrashRecovery();
    } catch (err) {
      console.error('[electron] Failed to ack crash recovery:', err);
    }
  }
}

/**
 * Open a URL in the default external browser.
 */
export async function openExternal(url: string): Promise<boolean> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.openExternal(url);
    } catch (err) {
      console.error('[electron] Failed to open external:', err);
      return false;
    }
  }
  // Fallback for browser environment
  if (typeof window !== 'undefined') {
    window.open(url, '_blank');
    return true;
  }
  return false;
}

/**
 * Subscribe to navigation events from the main process (deep links).
 * Returns a cleanup function.
 */
export function onNavigate(callback: (route: string) => void): () => void {
  const api = getControllerAPI();
  if (api) {
    return api.onNavigate(callback);
  }
  return () => {};
}

/**
 * Subscribe to crash recovery events.
 * Returns a cleanup function.
 */
export function onCrashRecovery(callback: (data: CrashRecoveryData) => void): () => void {
  const api = getControllerAPI();
  if (api) {
    return api.onCrashRecovery(callback);
  }
  return () => {};
}

/**
 * Read controller port preference (Electron only).
 */
export async function getControllerPortPreference(): Promise<ControllerPortPreference | null> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.getControllerPortPreference();
    } catch (err) {
      console.error('[electron] Failed to get controller port preference:', err);
    }
  }
  return null;
}

/**
 * Update controller port preference (Electron only).
 */
export async function setControllerPortPreference(preferredPort: number | null): Promise<number | null> {
  const api = getControllerAPI();
  if (api) {
    try {
      const result = await api.setControllerPortPreference(preferredPort);
      return result.preferredPort ?? null;
    } catch (err) {
      console.error('[electron] Failed to set controller port preference:', err);
    }
  }
  return null;
}

// ============================================================================
// Auto-update APIs
// ============================================================================

/**
 * Get the current update state.
 */
export async function getUpdateState(): Promise<UpdateState | null> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.getUpdateState();
    } catch (err) {
      console.error('[electron] Failed to get update state:', err);
      return null;
    }
  }
  return null;
}

/**
 * Check for available updates.
 */
export async function checkForUpdates(): Promise<{ available: boolean; version?: string; error?: string }> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.checkForUpdates();
    } catch (err) {
      console.error('[electron] Failed to check for updates:', err);
      return { available: false, error: String(err) };
    }
  }
  return { available: false };
}

/**
 * Download an available update.
 */
export async function downloadUpdate(): Promise<boolean> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.downloadUpdate();
    } catch (err) {
      console.error('[electron] Failed to download update:', err);
      return false;
    }
  }
  return false;
}

/**
 * Install a downloaded update and restart the app.
 */
export async function installUpdate(): Promise<boolean> {
  const api = getControllerAPI();
  if (api) {
    try {
      return await api.installUpdate();
    } catch (err) {
      console.error('[electron] Failed to install update:', err);
      return false;
    }
  }
  return false;
}

/**
 * Subscribe to update state changes.
 * Returns a cleanup function.
 */
export function onUpdateStateChanged(callback: (state: UpdateState) => void): () => void {
  const api = getControllerAPI();
  if (api) {
    return api.onUpdateStateChanged(callback);
  }
  return () => {};
}
