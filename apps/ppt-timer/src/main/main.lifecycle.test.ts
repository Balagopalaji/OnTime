import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PowerPointViewState } from '@ontime/presentation-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHUTDOWN_TIMEOUT_MS, REMOTE_SHUTDOWN_DEADLINE_MS, createAppLifecycle } from './app-lifecycle.js'
import { createAppControllers } from './controllers.js'
import type { SidecarCommand, SidecarConnection, SidecarEvent } from './publisher-sidecar/launcher.js'
import { createRemoteShare, type RemoteShareConfig } from './remote-share.js'
import { DEFAULT_SETTINGS } from './settings-schema.js'
import type { SessionHost } from './session-host.js'

// Main-process lifecycle for the packaged app with a publisher sidecar (ISSUE-002 S6d):
// quit/close/hide/crash behavior is exercised with injected fakes, never Electron.

const NONCE = 'n'.repeat(32)
const CONFIG: RemoteShareConfig = {
  cloud: { apiKey: 'key', projectId: 'ontime-prod', region: 'us-central1', emulatorHost: null },
  webOrigin: 'https://ontime.app',
}
const playing = { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } as PowerPointViewState
const modes = { timingMode: 'remaining', headlineMode: 'longest-remaining' } as const

type EventInput = SidecarEvent extends infer E ? (E extends unknown ? Omit<E, 'nonce'> : never) : never
type Fake = SidecarConnection & {
  sent: SidecarCommand[]
  deadlines: number[]
  emit(event: EventInput): void
  crash(): void
  hang: boolean
}

function fakeLauncher() {
  const connections: Fake[] = []
  const launcher = {
    start: async () => {
      const listeners: Array<(event: SidecarEvent) => void> = []
      const exits: Array<(reason: 'exited') => void> = []
      const connection: Fake = {
        sent: [],
        deadlines: [],
        hang: false,
        send: async (command) => (connection.sent.push(command), { ok: true }),
        onEvent: (listener) => void listeners.push(listener),
        onExit: (listener) => void exits.push(listener),
        crash: () => exits.forEach((listener) => listener('exited')),
        shutdown: (deadlineMs) => {
          connection.deadlines.push(deadlineMs)
          return connection.hang ? new Promise(() => undefined) : Promise.resolve('clean' as const)
        },
        emit: (event) => listeners.forEach((listener) => listener({ ...event, nonce: NONCE } as SidecarEvent)),
      }
      connections.push(connection)
      return connection
    },
  }
  return { launcher, connections }
}

function fakeHost(overrides: Partial<SessionHost> = {}): SessionHost {
  return {
    start: vi.fn(),
    getView: vi.fn(() => ({ revision: 7, state: playing })),
    setTimingMode: vi.fn(),
    setHeadlineMode: vi.fn(),
    getProtocolVersion: vi.fn(() => null),
    getHelperVersion: vi.fn(() => null),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  }
}

function setup(options: { host?: SessionHost } = {}) {
  const host = options.host ?? fakeHost()
  const { launcher, connections } = fakeLauncher()
  const share = createRemoteShare({
    config: CONFIG,
    launcher,
    openExternal: async () => undefined,
    copyToClipboard: async () => undefined,
    onChange: () => undefined,
    now: () => 1_000,
  })
  const quit = vi.fn()
  const exit = vi.fn()
  const onShutdown = vi.fn()
  const lifecycle = createAppLifecycle({ host, remoteShare: share, quit, exit, onShutdown })
  const event = () => ({ preventDefault: vi.fn() })
  return { host, share, connections, quit, exit, onShutdown, lifecycle, event }
}

const live = async (ctx: ReturnType<typeof setup>) => {
  await ctx.share.dispatch('start')
  ctx.connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('app quit with an active share (S6d)', () => {
  it('holds the quit, shuts the sidecar down inside the existing gate, closes the helper, then exits once', async () => {
    const ctx = setup()
    await live(ctx)
    const first = ctx.event()
    ctx.lifecycle.beforeQuit(first)
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(ctx.onShutdown).toHaveBeenCalledOnce()
    expect(ctx.host.shutdown).toHaveBeenCalledOnce()
    expect(ctx.connections[0].deadlines).toEqual([REMOTE_SHUTDOWN_DEADLINE_MS])
    expect(REMOTE_SHUTDOWN_DEADLINE_MS).toBeLessThan(SHUTDOWN_TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('a repeated quit while pending is held without a second shutdown or an early exit', async () => {
    const ctx = setup()
    await live(ctx)
    ctx.connections[0].hang = true
    ctx.lifecycle.beforeQuit(ctx.event())
    const second = ctx.event()
    ctx.lifecycle.beforeQuit(second)
    expect(second.preventDefault).toHaveBeenCalledOnce()
    expect(ctx.host.shutdown).toHaveBeenCalledOnce()
    expect(ctx.connections[0].deadlines).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1)
    expect(ctx.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ctx.exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('a hung sidecar never wedges quit beyond SHUTDOWN_TIMEOUT_MS', async () => {
    const ctx = setup()
    await live(ctx)
    ctx.connections[0].hang = true
    ctx.lifecycle.beforeQuit(ctx.event())
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS)
    expect(ctx.exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('a hung helper close still lets the sidecar close first and exits at the gate', async () => {
    const ctx = setup({ host: fakeHost({ shutdown: () => new Promise(() => undefined) }) })
    await live(ctx)
    ctx.lifecycle.beforeQuit(ctx.event())
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1)
    expect(ctx.connections[0].deadlines).toEqual([REMOTE_SHUTDOWN_DEADLINE_MS])
    expect(ctx.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ctx.exit).toHaveBeenCalledOnce()
  })

  it('a throwing or rejecting shutdown on either side never skips the other or the exit', async () => {
    const ctx = setup({ host: fakeHost({ shutdown: vi.fn(() => Promise.reject(new Error('helper close failed'))) }) })
    await live(ctx)
    ctx.connections[0].shutdown = () => {
      throw new Error('sidecar shutdown threw')
    }
    ctx.lifecycle.beforeQuit(ctx.event())
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.host.shutdown).toHaveBeenCalledOnce()
    expect(ctx.exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('quits cleanly when no share was ever started (no sidecar to stop)', async () => {
    const ctx = setup()
    ctx.lifecycle.beforeQuit(ctx.event())
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.connections).toHaveLength(0)
    expect(ctx.host.shutdown).toHaveBeenCalledOnce()
    expect(ctx.exit).toHaveBeenCalledOnce()
  })

  it('OS session end runs the same single shutdown without waiting on a quit event', async () => {
    const ctx = setup()
    await live(ctx)
    ctx.lifecycle.sessionEnd()
    ctx.lifecycle.beforeQuit(ctx.event())
    expect(ctx.host.shutdown).toHaveBeenCalledOnce()
    expect(ctx.connections[0].deadlines).toEqual([REMOTE_SHUTDOWN_DEADLINE_MS])
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.exit).toHaveBeenCalledOnce()
  })

  it('shutdown during a sidecar respawn cancels the respawn instead of launching a new sidecar', async () => {
    const ctx = setup()
    await live(ctx)
    ctx.connections[0].crash()
    expect(ctx.share.view().status).toBe('restarting')
    ctx.lifecycle.beforeQuit(ctx.event())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(ctx.connections).toHaveLength(1)
    expect(ctx.exit).toHaveBeenCalledOnce()
  })
})

describe('window close, hide, and update (S6d)', () => {
  it('closing the last window is the explicit quit path (no tray or background share)', () => {
    const ctx = setup()
    ctx.lifecycle.windowAllClosed()
    expect(ctx.quit).toHaveBeenCalledOnce()
  })

  it('main.ts routes quit through the lifecycle and hides/minimizes nothing into a quit', () => {
    const main = readFileSync(path.join(__dirname, 'main.ts'), 'utf8')
    expect(main).toContain("app.on('before-quit', lifecycle.beforeQuit)")
    expect(main).toContain("app.on('window-all-closed', lifecycle.windowAllClosed)")
    expect(main).toContain("mainWindow.on('session-end', lifecycle.sessionEnd)")
    // Hiding/minimizing keeps the host and sidecar running: no listener may quit or shut down on them.
    expect(main).not.toMatch(/\.on\(\s*'(hide|minimize|blur)'/)
  })

  it('has no auto-update path, so no installer handoff can bypass the sidecar shutdown gate', () => {
    // Defect guard: if an updater is ever added, its quit-and-install must go through
    // app-lifecycle's gate (stop sharing + sidecar before the installer handoff).
    const sources = ['main.ts', 'remote-share-electron.ts', 'app-lifecycle.ts', 'window-effects.ts']
    for (const file of sources) {
      expect(readFileSync(path.join(__dirname, file), 'utf8'), file).not.toMatch(/autoUpdater|quitAndInstall|electron-updater/)
    }
    const config = readFileSync(path.join(__dirname, '../../electron-builder.yml'), 'utf8')
    expect(config).not.toMatch(/^\s*publish:/m)
  })
})

describe('sidecar crash never affects the local timer (main level)', () => {
  it('keeps serving the local view and host while the sidecar crashes, respawns, and finally gives up', async () => {
    const host = fakeHost()
    const ctx = setup({ host })
    const controllers = createAppControllers({
      host,
      getSettings: () => ({ ...DEFAULT_SETTINGS }),
      saveSettings: vi.fn(async () => undefined),
      displays: () => [],
      upsell: { url: null, ctaAvailable: false },
      openExternal: vi.fn(async () => undefined),
      copyToClipboard: vi.fn(async () => undefined),
      getDiagnosticsReport: () => '',
      effects: { setAlwaysOnTop: vi.fn(), applyPreset: vi.fn(), moveToDisplay: vi.fn(), setPanelMode: vi.fn(), minimizeWindow: vi.fn(), closeWindow: vi.fn() },
      remoteShare: ctx.share,
    })
    await live(ctx)

    // Initial crash plus the three budgeted respawns (1 s, 5 s, 30 s) all crash.
    const delays = [1_000, 5_000, 30_000]
    ctx.connections[0].crash()
    for (const [index, delay] of delays.entries()) {
      expect(controllers.getView().remoteShare?.status).toBe('restarting')
      expect(controllers.getView().state).toBe(playing)
      expect(() => ctx.share.offer(playing, modes)).not.toThrow()
      await vi.advanceTimersByTimeAsync(delay)
      expect(ctx.connections).toHaveLength(index + 2)
      ctx.connections[index + 1].crash()
    }
    expect(controllers.getView().remoteShare?.status).toBe('failed')
    expect(controllers.getView().state).toBe(playing)
    // No further respawn once the budget is spent; nothing touched the host or window.
    await vi.advanceTimersByTimeAsync(120_000)
    expect(ctx.connections).toHaveLength(4)
    expect(host.shutdown).not.toHaveBeenCalled()
    expect(host.start).not.toHaveBeenCalled()
    expect(host.setTimingMode).not.toHaveBeenCalled()
    expect(ctx.exit).not.toHaveBeenCalled()
    expect(ctx.quit).not.toHaveBeenCalled()
  })

  it('a launcher that cannot start the sidecar reports failure without throwing into the host poll', async () => {
    const host = fakeHost()
    const share = createRemoteShare({
      config: CONFIG,
      launcher: { start: async () => Promise.reject(new Error('handshake-timeout')) },
      openExternal: async () => undefined,
      copyToClipboard: async () => undefined,
      onChange: () => undefined,
    })
    await expect(share.dispatch('start')).resolves.toBeUndefined()
    expect(() => share.offer(playing, modes)).not.toThrow()
    expect(['restarting', 'failed']).toContain(share.view().status)
    expect(host.getView().state).toBe(playing)
  })
})
