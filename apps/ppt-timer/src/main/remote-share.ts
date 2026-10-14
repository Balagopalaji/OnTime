/**
 * Main-process remote-share controller (ISSUE-002 S6c): explicit operator
 * share/stop/end/sign-out over the publisher sidecar lifecycle, poll-cadence
 * candidate forwarding, approval-URL pinning, and app-callback relay. The
 * renderer sees only a safe status and whether a viewer link exists; the URL
 * itself goes to the clipboard on an explicit copy.
 */
import type { PowerPointHeadlineMode, PowerPointTimingMode, PowerPointViewState } from '@ontime/presentation-core'
import type { RemoteShareCommand, RemoteShareStatus, RemoteShareView } from '../shared/ipc-contract.js'
import { isAllowedApprovalUrl, parseAuthCallbackUrl } from './publisher-sidecar/approval.js'
import { toSnapshotCandidate } from './publisher-sidecar/candidate-adapter.js'
import { parseCloudConfig, type CloudConfig } from './publisher-sidecar/cloud-client.js'
import type { SidecarConnection, SidecarEvent, SidecarLauncher } from './publisher-sidecar/launcher.js'
import { createPublisherLifecycle } from './publisher-sidecar/lifecycle.js'

export const CALLBACK_SCHEME = 'downstage-ppt-timer'
/**
 * How long End/Sign out wait for the sidecar's final status: above the
 * sidecar's worst case (credential refresh + callable, 15 s request timeout each).
 */
export const COMMAND_TIMEOUT_MS = 40_000

/** True when a launch's argv carries the app callback scheme (relaunch by the browser, not the operator). */
export const carriesCallbackUrl = (argv: readonly string[]): boolean => argv.some((arg) => arg.toLowerCase().startsWith(`${CALLBACK_SCHEME}://`))

export type RemoteShareConfig = { cloud: CloudConfig; webOrigin: string }

/** Non-secret cloud target from the environment; incomplete → sharing unavailable (no defaults that could leak). */
export function readRemoteShareConfig(env: Record<string, string | undefined>): RemoteShareConfig | null {
  const { ONTIME_FIREBASE_API_KEY: apiKey, ONTIME_FIREBASE_PROJECT_ID: projectId, ONTIME_WEB_ORIGIN: webOrigin } = env
  if (!apiKey || !projectId || !webOrigin) return null
  let origin: string
  try {
    origin = new URL(webOrigin).origin
  } catch {
    return null
  }
  const cloud = parseCloudConfig({
    apiKey,
    projectId,
    region: env.ONTIME_FIREBASE_REGION || 'us-central1',
    emulatorHost: env.ONTIME_FIREBASE_EMULATOR_HOST || null,
  })
  return cloud ? { cloud, webOrigin: origin } : null
}

const ACTIVE: ReadonlySet<RemoteShareStatus> = new Set(['connecting', 'awaiting-approval', 'live', 'retrying', 'restarting'])
const FINAL: Record<'END_SESSION' | 'SIGN_OUT', ReadonlySet<string>> = {
  END_SESSION: new Set(['ended', 'paused']),
  SIGN_OUT: new Set(['signed-out']),
}
/** Sidecar statuses after which the share run is over and the process can be released. */
const TERMINAL = new Set(['ended', 'signed-out', 'storage-unavailable', 'approval-failed', 'not-configured'])

export function createRemoteShare(options: {
  config: RemoteShareConfig | null
  launcher: SidecarLauncher
  openExternal(url: string): Promise<void>
  copyToClipboard(text: string): Promise<void>
  onChange(): void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let status: RemoteShareStatus = 'off'
  let viewerUrl: string | null = null
  /** Short-lived sidecar running End/Sign out while nothing is shared. */
  let temporary: SidecarConnection | null = null
  /** The in-flight End/Sign out: later final commands join it, and other share controls are inert. */
  let finalPending: Promise<void> | null = null
  const statusListeners = new Set<(status: string) => void>()

  const set = (next: RemoteShareStatus) => {
    if (next === status) return
    status = next
    options.onChange()
  }

  const handle = (event: SidecarEvent) => {
    if (event.kind === 'AUTH_REQUIRED') {
      if (options.config && isAllowedApprovalUrl(event.url, options.config.webOrigin)) void options.openExternal(event.url).catch(() => undefined)
      return
    }
    if (event.kind === 'VIEWER_LINK') {
      viewerUrl = event.url
      return options.onChange()
    }
    if (event.kind !== 'PUBLISH_STATUS') return
    for (const listener of statusListeners) listener(event.status)
    if (event.status === 'ended' || event.status === 'signed-out') viewerUrl = null
    set(event.status)
    if (TERMINAL.has(event.status)) release()
  }

  /** The connection that represents the share: the lifecycle's live one, or a short-lived command sidecar. */
  const live = () => temporary ?? lifecycle.connection()
  /** Route events only from that connection (retired, crashed, or racing ones are ignored). */
  const attach = (connection: SidecarConnection) => connection.onEvent((event) => connection === live() && handle(event))
  const lifecycle = createPublisherLifecycle({
    launcher: {
      start: async () => {
        const connection = await options.launcher.start()
        attach(connection)
        return connection
      },
    },
    onStatus: (process) => {
      if (process === 'restarting' || process === 'failed') set(process)
    },
  })

  /** Stop the sidecar; the lifecycle detaches it first, so its pause echo cannot overwrite the final status. */
  function release() {
    void lifecycle.stopSharing()
  }

  /**
   * Send a final command on the live sidecar, or a short-lived one, and wait for its outcome.
   * If that sidecar exits or refuses, fail fast with `failed` instead of retrying: the lifecycle's
   * respawn is cancelled (it would resume the session being ended) and the operator can run End again.
   */
  async function finalCommand(kind: 'END_SESSION' | 'SIGN_OUT') {
    let connection = lifecycle.connection()
    const shortLived = connection === null
    if (shortLived) {
      await lifecycle.stopSharing()
      connection = await options.launcher.start().catch(() => null)
      if (!connection) return set('failed')
      temporary = connection
      attach(connection)
    }
    const target = connection as SidecarConnection
    let settled = false
    let finish!: (outcome: 'ok' | 'timeout' | 'lost') => void
    const completed = new Promise<'ok' | 'timeout' | 'lost'>((resolve) => {
      const timer = setTimeout(() => finish('timeout'), COMMAND_TIMEOUT_MS)
      const listener = (next: string) => FINAL[kind].has(next) && finish('ok')
      finish = (outcome) => {
        settled = true
        clearTimeout(timer)
        statusListeners.delete(listener)
        resolve(outcome)
      }
      statusListeners.add(listener)
    })
    target.onExit(() => {
      if (settled) return
      if (!shortLived) void lifecycle.stopSharing()
      finish('lost')
    })
    if (!(await target.send({ kind })).ok && !settled) finish('lost')
    const outcome = await completed
    if (shortLived) {
      temporary = null
      await target.shutdown(2_000)
    } else if (lifecycle.connection() === target) {
      release()
    }
    // No final status: say so rather than leaving a stale "Live".
    if (outcome === 'lost') set('failed')
    else if (outcome === 'timeout') set(shortLived ? 'failed' : 'paused')
  }

  /** Single-flight: a repeated final command joins the pending one instead of spawning another sidecar. */
  function runFinal(kind: 'END_SESSION' | 'SIGN_OUT'): Promise<void> {
    if (finalPending) return finalPending
    finalPending = finalCommand(kind).finally(() => {
      finalPending = null
      options.onChange()
    })
    options.onChange()
    return finalPending
  }

  return {
    view: (): RemoteShareView => ({ available: options.config !== null, status, hasViewerLink: viewerUrl !== null, busy: finalPending !== null }),
    async dispatch(command: RemoteShareCommand): Promise<void> {
      if (!options.config) return set('not-configured')
      switch (command) {
        case 'start':
          if (finalPending || ACTIVE.has(status)) return
          set('connecting')
          return lifecycle.startSharing()
        case 'stop':
          // A pending End/Sign out owns the connection; detaching it would drop the final status.
          if (finalPending) return
          if (ACTIVE.has(status)) set('paused')
          return lifecycle.stopSharing()
        case 'end':
          return runFinal('END_SESSION')
        case 'signOut':
          return runFinal('SIGN_OUT')
        case 'copyLink':
          if (viewerUrl) await options.copyToClipboard(viewerUrl)
          return
      }
    },
    /** Every host poll: forward the reconstructed candidate (latest-only downstream). */
    offer(state: PowerPointViewState, modes: { timingMode: PowerPointTimingMode; headlineMode: PowerPointHeadlineMode }) {
      if (!ACTIVE.has(status)) return
      const candidate = toSnapshotCandidate(state, now(), modes)
      if (candidate.ok) lifecycle.offerCandidate(candidate.value)
    },
    /** App callback URI (`open-url` / second-instance argv); true when it was a publisher-auth callback. */
    handleCallbackUrl(url: string): boolean {
      const callback = parseAuthCallbackUrl(url, CALLBACK_SCHEME)
      if (!callback) return false
      void live()?.send({ kind: 'AUTH_CALLBACK', ...callback })
      return true
    },
    shutdown: async (deadlineMs: number) => {
      const [result] = await Promise.all([lifecycle.shutdown(deadlineMs), temporary?.shutdown(deadlineMs)])
      return result
    },
  }
}

export type RemoteShare = ReturnType<typeof createRemoteShare>
