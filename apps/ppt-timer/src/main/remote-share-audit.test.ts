import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { PowerPointViewState } from '@ontime/presentation-core'
import { describe, expect, it, vi } from 'vitest'
import { createAppControllers, type WindowEffects } from './controllers.js'
import { createCredentialBroker, type CredentialFs, type SafeStorageLike } from './publisher-sidecar/credential-store.js'
import { createSidecarLauncher, type SpawnedSidecar } from './publisher-sidecar/launcher.js'
import type { SidecarCommand, SidecarConnection, SidecarEvent } from './publisher-sidecar/launcher.js'
import { carriesCallbackUrl, createRemoteShare, type RemoteShareConfig } from './remote-share.js'
import { DEFAULT_SETTINGS } from './settings-schema.js'
import { acquireSingleInstanceActivation, type ActivatableWindow, type SingleInstanceApp } from './single-instance.js'
import type { SessionHost } from './session-host.js'

// S-033 / RPV-001 / RPV-010 audit for remote sharing (ISSUE-002 S6d): sharing adds no window
// activation or z-order change, no extra helper process, and no plaintext secret on disk.

const srcMain = __dirname
const CONFIG: RemoteShareConfig = {
  cloud: { apiKey: 'key', projectId: 'ontime-prod', region: 'us-central1', emulatorHost: null },
  webOrigin: 'https://ontime.app',
}
const NONCE = 'n'.repeat(32)
const state = { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } as PowerPointViewState
const modes = { timingMode: 'remaining', headlineMode: 'longest-remaining' } as const
const CALLBACK = `downstage-ppt-timer://publisher-auth?challenge=${'c'.repeat(32)}&code=${'k'.repeat(43)}`

/** Production (non-test) sources that make up remote sharing: controller, Electron glue, whole sidecar. */
const remoteSources = [
  'remote-share.ts',
  'remote-share-electron.ts',
  'app-lifecycle.ts',
  ...readdirSync(path.join(srcMain, 'publisher-sidecar'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => `publisher-sidecar/${name}`),
]
/** Source text without comments, so prose about "focus" or "spawn" is not mistaken for calls. */
const code = (file: string) =>
  readFileSync(path.join(srcMain, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

type EventInput = SidecarEvent extends infer E ? (E extends unknown ? Omit<E, 'nonce'> : never) : never
type Fake = SidecarConnection & { sent: SidecarCommand[]; emit(event: EventInput): void }

function countingLauncher() {
  const connections: Fake[] = []
  let alive = 0
  let peak = 0
  const launcher = {
    start: async () => {
      const listeners: Array<(event: SidecarEvent) => void> = []
      let up = true
      const stop = () => {
        if (up) alive--
        up = false
      }
      alive++
      peak = Math.max(peak, alive)
      const connection: Fake = {
        sent: [],
        send: async (command) => (connection.sent.push(command), { ok: true }),
        onEvent: (listener) => void listeners.push(listener),
        onExit: () => undefined,
        shutdown: async () => (stop(), 'clean'),
        emit: (event) => listeners.forEach((listener) => listener({ ...event, nonce: NONCE } as SidecarEvent)),
      }
      connections.push(connection)
      return connection
    },
  }
  return { launcher, connections, peak: () => peak }
}

describe('remote sharing adds no window activation or z-order change (RPV-001, S-033)', () => {
  it('no remote-share source can focus, show, hide, restack, or open a window', () => {
    const forbidden =
      /\bBrowserWindow\b|\bwebContents\b|\.(focus|show|showInactive|hide|minimize|maximize|moveTop|setAlwaysOnTop|setBounds|setFocusable|setIgnoreMouseEvents|setVisibleOnAllWorkspaces|flashFrame)\(|\bapp\.focus\b|setWindowOpenHandler|\bnew Notification\b|\bTray\b/
    for (const file of remoteSources) expect(code(file), file).not.toMatch(forbidden)
  })

  it('share commands and callbacks never invoke any window effect or restart/poke the host', async () => {
    const effects: WindowEffects = {
      setAlwaysOnTop: vi.fn(),
      applyPreset: vi.fn(),
      moveToDisplay: vi.fn(),
      setPanelMode: vi.fn(),
      minimizeWindow: vi.fn(),
      closeWindow: vi.fn(),
    }
    const host: SessionHost = {
      start: vi.fn(),
      getView: vi.fn(() => ({ revision: 1, state })),
      setTimingMode: vi.fn(),
      setHeadlineMode: vi.fn(),
      getProtocolVersion: vi.fn(() => null),
      getHelperVersion: vi.fn(() => null),
      shutdown: vi.fn(async () => undefined),
    }
    const { launcher, connections } = countingLauncher()
    const opened: string[] = []
    const share = createRemoteShare({
      config: CONFIG,
      launcher,
      openExternal: async (url) => void opened.push(url),
      copyToClipboard: async () => undefined,
      onChange: () => undefined,
    })
    const controllers = createAppControllers({
      host,
      getSettings: () => ({ ...DEFAULT_SETTINGS }),
      saveSettings: vi.fn(async () => undefined),
      displays: () => [],
      upsell: { url: null, ctaAvailable: false },
      openExternal: vi.fn(async () => undefined),
      copyToClipboard: vi.fn(async () => undefined),
      getDiagnosticsReport: () => '',
      effects,
      remoteShare: share,
    })

    await controllers.dispatch({ type: 'remoteShare', command: 'start' })
    connections[0].emit({ kind: 'AUTH_REQUIRED', url: `https://ontime.app/publisher/device/approve?challenge=${'c'.repeat(32)}` })
    connections[0].emit({ kind: 'VIEWER_LINK', url: `https://ontime.app/session/s1/view#token=${'t'.repeat(43)}` })
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    share.offer(state, modes)
    share.handleCallbackUrl(CALLBACK)
    for (const command of ['copyLink', 'stop'] as const) await controllers.dispatch({ type: 'remoteShare', command })
    // End and sign-out after Stop run on short-lived sidecars that report their final status.
    for (const [index, [command, status]] of ([['end', 'ended'], ['signOut', 'signed-out']] as const).entries()) {
      const pending = controllers.dispatch({ type: 'remoteShare', command })
      await vi.waitFor(() => expect(connections).toHaveLength(index + 2))
      connections[index + 1].emit({ kind: 'PUBLISH_STATUS', status })
      await pending
    }

    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled()
    expect(host.start).not.toHaveBeenCalled()
    expect(host.setTimingMode).not.toHaveBeenCalled()
    expect(host.setHeadlineMode).not.toHaveBeenCalled()
    expect(host.shutdown).not.toHaveBeenCalled()
    // The only external page opened is the pinned approval URL, in the default browser.
    expect(opened).toEqual([`https://ontime.app/publisher/device/approve?challenge=${'c'.repeat(32)}`])
  })

  it('the browser auth-callback relaunch is relayed to the sidecar but never activates the timer window', () => {
    const listeners: Array<(event: unknown, argv: string[]) => void> = []
    const app: SingleInstanceApp = { requestSingleInstanceLock: () => true, quit: vi.fn(), on: (_event, listener) => void listeners.push(listener) }
    const activation = acquireSingleInstanceActivation(app, vi.fn(), carriesCallbackUrl)
    const calls: string[] = []
    const window: ActivatableWindow = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: () => void calls.push('restore'),
      isVisible: () => false,
      show: () => void calls.push('show'),
      focus: () => void calls.push('focus'),
    }
    activation?.windowReady(window)
    listeners.forEach((listener) => listener({}, ['Downstage.exe', CALLBACK]))
    expect(calls).toEqual([])
    // A genuine second launch by the operator still activates (single-instance behavior unchanged).
    listeners.forEach((listener) => listener({}, ['Downstage.exe']))
    expect(calls).toEqual(['restore', 'show', 'focus'])
  })
})

describe('remote sharing never adds a second native helper or process (S-033)', () => {
  it('the only process-creation API in app sources is the one sidecar utility process', () => {
    const files = readdirSync(srcMain, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    const spawning = /child_process|utilityProcess\.fork|\bfork\s*\(|new Worker\(/
    // The helper itself is started by @ontime/ppt-bridge (session-host); main spawns only the sidecar.
    expect(files.filter((file) => spawning.test(code(file)))).toEqual(['publisher-sidecar/electron-spawn.ts'])
    expect(code('publisher-sidecar/electron-spawn.ts').match(/utilityProcess\.fork/g)).toHaveLength(1)
    // The native helper binary is named only by discovery and release tooling, never by sharing code.
    expect(files.filter((file) => /ppt-probe/.test(code(file))).sort()).toEqual(['build-manifest.ts', 'helper-discovery.ts'])
  })

  it('remote sharing never reaches the helper or host: no ppt-bridge, session-host, or helper discovery import', () => {
    for (const file of remoteSources) {
      expect(code(file), file).not.toMatch(/ppt-bridge|session-host|helper-discovery|PPT_PROBE_PATH/)
    }
  })

  it('at most one sidecar runs at a time across share, stop, re-share, and double-start', async () => {
    const { launcher, connections, peak } = countingLauncher()
    const share = createRemoteShare({
      config: CONFIG,
      launcher,
      openExternal: async () => undefined,
      copyToClipboard: async () => undefined,
      onChange: () => undefined,
    })
    await Promise.all([share.dispatch('start'), share.dispatch('start')])
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    await share.dispatch('stop')
    await share.dispatch('start')
    await share.dispatch('start')
    await share.shutdown(500)
    expect(peak()).toBe(1)
    expect(connections.length).toBe(2)
  })
})

describe('remote sharing writes no plaintext secret (RPV-001 stop condition)', () => {
  it('only the sealed broker file is written, and it never contains the sidecar secret', async () => {
    const SECRET = '{"v":1,"devicePrivateKey":"PRIVATE-KEY-MATERIAL","session":{"refreshToken":"REFRESH-TOKEN-MATERIAL"}}'
    const writes: Array<{ path: string; data: Buffer }> = []
    const files = new Map<string, Buffer>()
    const fs: CredentialFs = {
      readFile: async (p) => files.get(p) ?? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      writeFile: async (p, data) => void (writes.push({ path: p, data: Buffer.from(data) }), files.set(p, Buffer.from(data))),
      rename: async (from, to) => void (files.set(to, files.get(from) as Buffer), files.delete(from)),
      rm: async (p) => void files.delete(p),
    }
    const safeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from([...Buffer.from(text, 'utf8')].map((byte) => byte ^ 0x5a)),
      decryptString: (bytes) => Buffer.from([...bytes].map((byte) => byte ^ 0x5a)).toString('utf8'),
    }
    const FILE = '/user/data/publisher-credential.bin'
    const toSidecar: unknown[] = []
    let deliver: (message: unknown) => void = () => undefined
    const child: SpawnedSidecar = {
      port: {
        postMessage: (message) => {
          toSidecar.push(message)
          const hello = message as { kind?: string; nonce?: string }
          if (hello.kind === 'HELLO') {
            deliver({ kind: 'READY', nonce: hello.nonce, protocolMajor: 1, capabilities: ['publish'] })
            deliver({ kind: 'SEAL_REQUEST', nonce: hello.nonce, requestId: 1, data: SECRET })
          }
        },
        onMessage: (listener) => void (deliver = listener),
        close: () => undefined,
      },
      kill: () => undefined,
      onExit: () => undefined,
    }
    const launcher = createSidecarLauncher({ spawn: () => child, broker: createCredentialBroker({ safeStorage, fs, filePath: FILE }) })
    await launcher.start()
    await vi.waitFor(() => expect(toSidecar.some((message) => (message as { kind?: string }).kind === 'SEAL_RESULT')).toBe(true))

    expect(writes.length).toBeGreaterThan(0)
    for (const write of writes) {
      expect(write.path).toMatch(/^\/user\/data\/publisher-credential\.bin(\.\d+\.tmp)?$/)
      expect(write.data.includes(Buffer.from('PRIVATE-KEY-MATERIAL'))).toBe(false)
      expect(write.data.includes(Buffer.from('REFRESH-TOKEN-MATERIAL'))).toBe(false)
    }
    expect([...files.keys()]).toEqual([FILE])
    expect(files.get(FILE)?.subarray(0, 6).toString('utf8')).toBe('ODPC1\n')
    // The secret travelled only over the private channel, and the reply carries no data back.
    expect(JSON.stringify(toSidecar.filter((message) => (message as { kind?: string }).kind === 'SEAL_RESULT'))).not.toContain('MATERIAL')
  })

  it('no source other than the Electron glue touches the filesystem, and the glue writes one broker file only', () => {
    for (const file of remoteSources.filter((name) => name !== 'remote-share-electron.ts')) {
      expect(code(file), file).not.toMatch(/node:fs|fs\/promises|require\(\s*'fs'\s*\)|localStorage/)
    }
    const glue = code('remote-share-electron.ts')
    expect(glue.match(/filePath:/g)).toHaveLength(1)
    expect(glue).toContain("join(app.getPath('userData'), 'publisher-credential.bin')")
    expect(glue).not.toMatch(/settings\.json|writeFileSync|appendFile|console\./)
  })

  it('credentials never enter the settings schema or the renderer-visible view', () => {
    const schema = readFileSync(path.join(srcMain, 'settings-schema.ts'), 'utf8')
    expect(schema).not.toMatch(/token|secret|credential|refresh|privateKey/i)
    const { launcher } = countingLauncher()
    const share = createRemoteShare({ config: CONFIG, launcher, openExternal: async () => undefined, copyToClipboard: async () => undefined, onChange: () => undefined })
    expect(Object.keys(share.view()).sort()).toEqual(['available', 'busy', 'hasViewerLink', 'status'])
  })
})
