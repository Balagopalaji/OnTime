import type { PowerPointViewState } from '@ontime/presentation-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SidecarCommand, SidecarConnection, SidecarEvent } from './publisher-sidecar/launcher.js'
import { COMMAND_TIMEOUT_MS, carriesCallbackUrl, createRemoteShare, readLanConfig, readRemoteShareConfig, type RemoteShareConfig } from './remote-share.js'

const NONCE = 'n'.repeat(32)
const CONFIG: RemoteShareConfig = {
  cloud: { apiKey: 'key', projectId: 'ontime-prod', region: 'us-central1', emulatorHost: null },
  webOrigin: 'https://ontime.app',
}
const VIEWER = `https://ontime.app/session/s1/view#token=${'t'.repeat(43)}`
const APPROVAL = `https://ontime.app/publisher/device/approve?challenge=${'c'.repeat(32)}`
const noSlideshow = { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } as PowerPointViewState
const modes = { timingMode: 'remaining', headlineMode: 'longest-remaining' } as const
const flush = () => new Promise((r) => setTimeout(r, 0))

type EventInput = SidecarEvent extends infer E ? (E extends unknown ? Omit<E, 'nonce'> : never) : never
type Fake = SidecarConnection & { sent: SidecarCommand[]; emit(event: EventInput): void; exit(): void; shutdowns: number; gate?: Promise<void> }
function fakeLauncher() {
  const connections: Fake[] = []
  const launcher = {
    start: async () => {
      const listeners: Array<(event: SidecarEvent) => void> = []
      const exits: Array<(reason: 'exited') => void> = []
      const connection: Fake = {
        sent: [],
        shutdowns: 0,
        send: async (command) => (connection.sent.push(command), { ok: true }),
        onEvent: (listener) => void listeners.push(listener),
        onExit: (listener) => void exits.push(listener),
        exit: () => exits.forEach((l) => l('exited')),
        shutdown: async () => (connection.shutdowns++, await connection.gate, 'clean'),
        emit: (event) => listeners.forEach((l) => l({ ...event, nonce: NONCE } as SidecarEvent)),
      }
      connections.push(connection)
      return connection
    },
  }
  return { launcher, connections }
}

function setup(config: RemoteShareConfig | null = CONFIG, lan = false) {
  const { launcher, connections } = fakeLauncher()
  const opened: string[] = []
  const copied: string[] = []
  const onChange = vi.fn()
  const share = createRemoteShare({
    config,
    launcher,
    openExternal: async (url) => void opened.push(url),
    copyToClipboard: async (text) => void copied.push(text),
    onChange,
    lan,
    now: () => 5_000,
  })
  const kinds = (index: number) => connections[index].sent.map((c) => c.kind)
  return { share, connections, opened, copied, onChange, kinds }
}

afterEach(() => vi.useRealTimers())

describe('remote share controller (main process)', () => {
  it('shares on explicit start and forwards poll-cadence candidates once sharing', async () => {
    const { share, connections, kinds } = setup()
    share.offer(noSlideshow, modes)
    await share.dispatch('start')
    expect(share.view()).toEqual({ available: true, status: 'connecting', hasViewerLink: false, busy: false })
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    share.offer(noSlideshow, modes)
    await flush()
    expect(kinds(0)).toEqual(['SHARE_START', 'SNAPSHOT_CANDIDATE'])
    expect(connections[0].sent[1]).toEqual({
      kind: 'SNAPSHOT_CANDIDATE',
      candidate: { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs: 5_000, availability: 'source-unavailable', payload: { reason: 'no-slideshow' } },
    })
    expect(share.view().status).toBe('live')
  })

  it('opens only approval URLs on the configured web origin', async () => {
    // Defect: a compromised sidecar makes main open an arbitrary page.
    const { share, connections, opened } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'AUTH_REQUIRED', url: APPROVAL })
    connections[0].emit({ kind: 'AUTH_REQUIRED', url: APPROVAL.replace('ontime.app', 'evil.example') })
    expect(opened).toEqual([APPROVAL])
  })

  it('keeps the viewer URL out of the renderer view and copies it only on request', async () => {
    const { share, connections, copied } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'VIEWER_LINK', url: VIEWER })
    expect(JSON.stringify(share.view())).not.toContain('token')
    expect(share.view().hasViewerLink).toBe(true)
    await share.dispatch('copyLink')
    expect(copied).toEqual([VIEWER])
  })

  it('relays only well-formed publisher-auth callbacks to the sidecar', async () => {
    const { share, connections } = setup()
    await share.dispatch('start')
    const code = 'k'.repeat(43)
    expect(share.handleCallbackUrl(`downstage-ppt-timer://publisher-auth?challenge=${'c'.repeat(32)}&code=${code}`)).toBe(true)
    expect(share.handleCallbackUrl('downstage-ppt-timer://open?file=C:\\deck.pptx')).toBe(false)
    expect(connections[0].sent.at(-1)).toEqual({ kind: 'AUTH_CALLBACK', challengeId: 'c'.repeat(32), code })
  })

  it('releases the sidecar after a terminal status without the pause echo overwriting it, and can share again', async () => {
    // Defect: approval-failed shows as "paused", or Share never works again.
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'approval-failed' })
    await flush()
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'paused' })
    expect(kinds(0)).toContain('SHARE_STOP')
    expect(share.view().status).toBe('approval-failed')
    await share.dispatch('start')
    expect(connections).toHaveLength(2)
  })

  it('stop pauses sharing but keeps the viewer link for a later resume', async () => {
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'VIEWER_LINK', url: VIEWER })
    await share.dispatch('stop')
    expect(kinds(0)).toEqual(['SHARE_START', 'SHARE_STOP'])
    expect(share.view()).toEqual({ available: true, status: 'paused', hasViewerLink: true, busy: false })
  })

  it('end while sharing waits for the sidecar to end the session, then releases it', async () => {
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'VIEWER_LINK', url: VIEWER })
    const ending = share.dispatch('end')
    await flush()
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await ending
    expect(kinds(0)).toEqual(['SHARE_START', 'END_SESSION', 'SHARE_STOP'])
    expect(share.view()).toEqual({ available: true, status: 'ended', hasViewerLink: false, busy: false })
  })

  it('sign-out when not sharing runs on a short-lived sidecar', async () => {
    // Defect: Sign out silently does nothing unless a share is running.
    const { share, connections, kinds } = setup()
    const signingOut = share.dispatch('signOut')
    await flush()
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'signed-out' })
    await signingOut
    expect(kinds(0)).toEqual(['SIGN_OUT'])
    expect(connections[0].shutdowns).toBe(1)
    expect(share.view().status).toBe('signed-out')
  })

  it('gives up waiting for a final status after the command timeout', async () => {
    vi.useFakeTimers()
    const { share, connections } = setup()
    const ending = share.dispatch('end')
    await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS)
    await ending
    expect(connections[0].shutdowns).toBe(1)
  })

  it('signs out on a short-lived sidecar after the sharing sidecar crashed', async () => {
    // Defect: SIGN_OUT goes to the dead process, so the device is never revoked.
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].exit()
    const signingOut = share.dispatch('signOut')
    await flush()
    connections[1].emit({ kind: 'PUBLISH_STATUS', status: 'signed-out' })
    await signingOut
    expect(kinds(0)).toEqual(['SHARE_START'])
    expect(kinds(1)).toEqual(['SIGN_OUT'])
    expect(share.view().status).toBe('signed-out')
  })

  it.each([
    ['while sharing', true, 'paused'],
    ['on a short-lived sidecar', false, 'failed'],
  ] as const)('reports an End that never completes %s instead of showing a stale status', async (_label, sharing, expected) => {
    // Defect: after a silent timeout the UI still says Live (and Share is ignored).
    vi.useFakeTimers()
    const { share, connections } = setup()
    if (sharing) {
      await share.dispatch('start')
      connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    }
    const ending = share.dispatch('end')
    await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS)
    await ending
    expect(share.view().status).toBe(expected)
  })

  it('ignores Share while a short-lived End is still running', async () => {
    // Defect: a resume races the end on the same credential.
    const { share, connections } = setup()
    const ending = share.dispatch('end')
    await flush()
    await share.dispatch('start')
    expect(connections).toHaveLength(1)
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await ending
    expect(share.view().status).toBe('ended')
  })

  it('ignores Stop while End waits on the live sidecar so the final status still lands', async () => {
    // Defect: Stop detaches the connection, the ended event is dropped, and End hangs until the timeout.
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    const ending = share.dispatch('end')
    await flush()
    expect(share.view().busy).toBe(true)
    await share.dispatch('stop')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await ending
    expect(kinds(0)).toEqual(['SHARE_START', 'END_SESSION', 'SHARE_STOP'])
    expect(share.view()).toEqual({ available: true, status: 'ended', hasViewerLink: false, busy: false })
  })

  it('runs a repeated End/Sign out as one command while one is pending', async () => {
    // Defect: two short-lived sidecars; the first waits out the timeout and shows a false "failed".
    const { share, connections, kinds } = setup()
    const first = share.dispatch('end')
    const second = share.dispatch('end')
    const third = share.dispatch('signOut')
    await flush()
    expect(connections).toHaveLength(1)
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await Promise.all([first, second, third])
    expect(kinds(0)).toEqual(['END_SESSION'])
    expect(share.view().status).toBe('ended')
  })

  it('does not resume the session being ended when the live sidecar crashes during End', async () => {
    // Defect: the lifecycle respawns it with SHARE_START and End waits out the timeout.
    vi.useFakeTimers()
    const { share, connections, kinds } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    const ending = share.dispatch('end')
    await vi.advanceTimersByTimeAsync(0)
    connections[0].exit()
    await ending
    await vi.advanceTimersByTimeAsync(60_000)
    expect(connections).toHaveLength(1)
    expect(kinds(0)).toEqual(['SHARE_START', 'END_SESSION'])
    expect(share.view()).toMatchObject({ status: 'failed', busy: false })
  })

  it('fails a short-lived End promptly when its sidecar exits', async () => {
    vi.useFakeTimers()
    const { share, connections } = setup()
    const ending = share.dispatch('end')
    await vi.advanceTimersByTimeAsync(0)
    connections[0].exit()
    await ending
    expect(share.view()).toMatchObject({ status: 'failed', busy: false })
  })

  it('Stop only pauses an active share', async () => {
    // Defect: Stop from ended/signed-out/off rewrote the status to "paused".
    const { share, connections } = setup()
    await share.dispatch('stop')
    expect(share.view().status).toBe('off')
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await flush()
    await share.dispatch('stop')
    expect(share.view().status).toBe('ended')
  })

  it.each([
    ['live', async (share: ReturnType<typeof setup>['share'], connections: Fake[]) => { await share.dispatch('start'); connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' }) }],
    ['connecting', async (share: ReturnType<typeof setup>['share']) => { await share.dispatch('start') }],
  ])('shutdown waits for the %s sidecar to close', async (_label, arrange) => {
    const { share, connections } = setup()
    await arrange(share, connections)
    let release!: () => void
    connections[0].gate = new Promise<void>((resolve) => (release = resolve))
    let done = false
    const closing = share.shutdown(1_000).then((result) => ((done = true), result))
    await flush()
    expect(done).toBe(false)
    release()
    expect(await closing).toBe('clean')
    expect(connections[0].shutdowns).toBe(1)
  })

  it('shutdown waits for a short-lived End sidecar too', async () => {
    // Defect: quitting during End/Sign out returned before the command sidecar was closed.
    const { share, connections } = setup()
    const ending = share.dispatch('end')
    await flush()
    let release!: () => void
    connections[0].gate = new Promise<void>((resolve) => (release = resolve))
    let done = false
    const closing = share.shutdown(1_000).then(() => void (done = true))
    await flush()
    expect(done).toBe(false)
    release()
    await closing
    expect(connections[0].shutdowns).toBe(1)
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await ending
  })

  it('waits longer than the sidecar worst case (credential refresh + callable) before giving up', () => {
    expect(COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(35_000)
  })

  it('reports not-configured without spawning anything when the build has no cloud target', async () => {
    const { share, connections } = setup(null)
    await share.dispatch('start')
    expect(share.view()).toEqual({ available: false, status: 'not-configured', hasViewerLink: false, busy: false })
    expect(connections).toEqual([])
  })
})

describe('callback activation guard', () => {
  it.each([
    [['app.exe', 'downstage-ppt-timer://publisher-auth?challenge=x&code=y'], true],
    [['app.exe', 'DOWNSTAGE-PPT-TIMER://publisher-auth'], true],
    [['app.exe', '--flag', 'C:\\deck.pptx'], false],
    [['app.exe'], false],
  ])('%j → %s', (argv, expected) => {
    expect(carriesCallbackUrl(argv)).toBe(expected)
  })
})

describe('remote share config', () => {
  const env = { ONTIME_FIREBASE_API_KEY: 'key', ONTIME_FIREBASE_PROJECT_ID: 'ontime-prod', ONTIME_WEB_ORIGIN: 'https://ontime.app/' }
  it.each([
    [env, CONFIG],
    [{ ...env, ONTIME_FIREBASE_EMULATOR_HOST: '127.0.0.1', ONTIME_WEB_ORIGIN: 'http://localhost:5173' }, { cloud: { ...CONFIG.cloud, emulatorHost: '127.0.0.1' }, webOrigin: 'http://localhost:5173' }],
    [{ ...env, ONTIME_FIREBASE_EMULATOR_HOST: 'evil.example' }, null],
    [{ ...env, ONTIME_WEB_ORIGIN: 'not a url' }, null],
    [{ ONTIME_FIREBASE_PROJECT_ID: 'ontime-prod' }, null],
  ])('reads %j', (input, expected) => {
    expect(readRemoteShareConfig(input)).toEqual(expected)
  })
})

describe('LAN status in the share view (ISSUE-002 S9c)', () => {
  it('has no LAN field at all when LAN publishing is not configured', async () => {
    // Defect: the renderer shows a LAN row for a feature that is off, or an existing view shape changes.
    const { share, connections } = setup()
    await share.dispatch('start')
    connections[0].emit({ kind: 'LAN_STATUS', status: 'live' })
    expect(share.view()).not.toHaveProperty('lanStatus')
  })

  it('reports the sidecar LAN status next to, never instead of, the cloud status', async () => {
    // Defect: a LAN status overwrites the cloud status or the viewer link, or ends the share.
    const { share, connections, kinds } = setup(CONFIG, true)
    expect(share.view()).toEqual({ available: true, status: 'off', hasViewerLink: false, busy: false, lanStatus: 'off' })
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    connections[0].emit({ kind: 'VIEWER_LINK', url: VIEWER })
    connections[0].emit({ kind: 'LAN_STATUS', status: 'retrying' })
    expect(share.view()).toEqual({ available: true, status: 'live', hasViewerLink: true, busy: false, lanStatus: 'retrying' })
    connections[0].emit({ kind: 'LAN_STATUS', status: 'unavailable' })
    expect(share.view()).toMatchObject({ status: 'live', hasViewerLink: true, lanStatus: 'unavailable' })
    expect(kinds(0)).toEqual(['SHARE_START'])
    expect(connections[0].shutdowns).toBe(0)
  })

  it('Stop shows LAN paused and a completed End shows LAN ended', async () => {
    // Defect: a stale "live" LAN badge after the operator stopped or ended sharing.
    const { share, connections } = setup(CONFIG, true)
    await share.dispatch('start')
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    connections[0].emit({ kind: 'LAN_STATUS', status: 'live' })
    await share.dispatch('stop')
    expect(share.view()).toMatchObject({ status: 'paused', lanStatus: 'paused' })
    await share.dispatch('start')
    connections[1].emit({ kind: 'PUBLISH_STATUS', status: 'live' })
    connections[1].emit({ kind: 'LAN_STATUS', status: 'live' })
    const ending = share.dispatch('end')
    await flush()
    connections[1].emit({ kind: 'LAN_STATUS', status: 'ended' })
    connections[1].emit({ kind: 'PUBLISH_STATUS', status: 'ended' })
    await ending
    expect(share.view()).toMatchObject({ status: 'ended', lanStatus: 'ended' })
  })

  it('a cloud terminal state that releases the sidecar leaves LAN off, not stale', async () => {
    // Defect: the badge claims LAN is live after the sidecar process was released.
    const { share, connections } = setup(CONFIG, true)
    await share.dispatch('start')
    connections[0].emit({ kind: 'LAN_STATUS', status: 'live' })
    connections[0].emit({ kind: 'PUBLISH_STATUS', status: 'approval-failed' })
    await flush()
    expect(share.view()).toMatchObject({ status: 'approval-failed', lanStatus: 'off' })
  })
})

describe('LAN config from the environment', () => {
  it('is off unless a room is configured', () => {
    expect(readLanConfig({})).toBeNull()
    expect(readLanConfig({ ONTIME_COMPANION_URL: 'http://127.0.0.1:4000' })).toBeNull()
  })

  it.each([
    [{ ONTIME_LAN_ROOM_ID: 'room-1' }, { companionUrl: 'http://127.0.0.1:4000', roomId: 'room-1' }],
    [{ ONTIME_LAN_ROOM_ID: 'room-1', ONTIME_COMPANION_URL: 'http://localhost:4010' }, { companionUrl: 'http://localhost:4010', roomId: 'room-1' }],
    [{ ONTIME_LAN_ROOM_ID: 'room-1', ONTIME_COMPANION_URL: 'http://192.168.1.9:4000' }, null],
    [{ ONTIME_LAN_ROOM_ID: '  ' }, null],
  ])('reads %j', (env, expected) => {
    expect(readLanConfig(env)).toEqual(expected)
  })
})
