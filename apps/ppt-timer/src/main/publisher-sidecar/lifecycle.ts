/**
 * Main-side publisher lifecycle: explicit share start/stop, one-in-flight /
 * one-latest candidate forwarding, bounded respawn after a sidecar crash
 * (the sidecar resumes its session under a new epoch at S6c), and bounded
 * shutdown. Failures are reported as statuses and never thrown into the host,
 * so the local countdown is never interrupted.
 */
import type { RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import type { SidecarConnection, SidecarLauncher } from './launcher'

export type PublisherStatus = 'idle' | 'starting' | 'sharing' | 'restarting' | 'stopping' | 'failed'

const STOP_DEADLINE_MS = 2_000

export function createPublisherLifecycle(options: {
  launcher: SidecarLauncher
  respawnDelaysMs?: number[]
  /** Sharing this long without a crash refreshes the respawn budget. */
  stableAfterMs?: number
  onStatus?: (status: PublisherStatus) => void
}) {
  const respawnDelaysMs = options.respawnDelaysMs ?? [1_000, 5_000, 30_000]
  const stableAfterMs = options.stableAfterMs ?? 60_000
  let status: PublisherStatus = 'idle'
  let connection: SidecarConnection | null = null
  let wantSharing = false
  let latest: RemoteSnapshotCandidateV1 | null = null
  let dirty = false
  let inFlight = false
  let respawnsUsed = 0
  let respawnTimer: ReturnType<typeof setTimeout> | null = null
  let stableTimer: ReturnType<typeof setTimeout> | null = null
  /** Connections deliberately being shut down; their exits are not crashes. */
  const retiring = new WeakSet<SidecarConnection>()

  const setStatus = (next: PublisherStatus) => {
    if (next === status) return
    status = next
    options.onStatus?.(next)
  }

  const clearTimers = () => {
    if (respawnTimer) clearTimeout(respawnTimer)
    if (stableTimer) clearTimeout(stableTimer)
    respawnTimer = null
    stableTimer = null
  }

  /** Detach synchronously (so a concurrent start can never be overwritten), then shut down. */
  const retire = async (target: SidecarConnection, deadlineMs: number) => {
    retiring.add(target)
    if (connection === target) connection = null
    return target.shutdown(deadlineMs)
  }

  const pump = (): void => {
    const current = connection
    if (!current || status !== 'sharing' || inFlight || !dirty || latest === null) return
    inFlight = true
    dirty = false
    void current.send({ kind: 'SNAPSHOT_CANDIDATE', candidate: latest }).finally(() => {
      inFlight = false
      pump()
    })
  }

  const onUnexpectedExit = (): void => {
    connection = null
    inFlight = false
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = null
    if (!wantSharing) return
    if (respawnsUsed >= respawnDelaysMs.length) {
      // Give up until the operator explicitly shares again.
      wantSharing = false
      setStatus('failed')
      return
    }
    setStatus('restarting')
    respawnTimer = setTimeout(() => {
      respawnTimer = null
      void connect()
    }, respawnDelaysMs[respawnsUsed++])
  }

  async function connect(): Promise<void> {
    let next: SidecarConnection
    try {
      next = await options.launcher.start()
    } catch {
      onUnexpectedExit()
      return
    }
    if (!wantSharing || connection !== null) {
      await retire(next, STOP_DEADLINE_MS)
      return
    }
    connection = next
    next.onExit(() => {
      if (!retiring.has(next) && connection === next) onUnexpectedExit()
    })
    const started = await next.send({ kind: 'SHARE_START' })
    if (connection !== next) return
    if (!started.ok) {
      // A refusing sidecar is replaced like a crashed one (bounded by the respawn budget).
      await retire(next, STOP_DEADLINE_MS)
      onUnexpectedExit()
      return
    }
    setStatus('sharing')
    stableTimer = setTimeout(() => {
      stableTimer = null
      respawnsUsed = 0
    }, stableAfterMs)
    dirty = latest !== null
    pump()
  }

  return {
    status: () => status,
    /** The connection currently carrying the share (null while starting, restarting, stopped, or failed). */
    connection: () => connection,
    async startSharing(): Promise<void> {
      if (wantSharing) return
      wantSharing = true
      respawnsUsed = 0
      setStatus('starting')
      await connect()
    },
    /** Newest host candidate; replaces any waiting one. Never throws. */
    offerCandidate(candidate: RemoteSnapshotCandidateV1): void {
      latest = candidate
      dirty = true
      pump()
    },
    async stopSharing(): Promise<void> {
      wantSharing = false
      clearTimers()
      latest = null
      const current = connection
      if (!current) {
        setStatus('idle')
        return
      }
      setStatus('stopping')
      retiring.add(current)
      connection = null
      await current.send({ kind: 'SHARE_STOP' })
      await current.shutdown(STOP_DEADLINE_MS)
      if (!wantSharing) setStatus('idle')
    },
    async shutdown(deadlineMs: number): Promise<'clean' | 'killed' | 'not-running'> {
      wantSharing = false
      clearTimers()
      const current = connection
      if (!current) {
        setStatus('idle')
        return 'not-running'
      }
      const result = await retire(current, deadlineMs)
      if (!wantSharing) setStatus('idle')
      return result
    },
  }
}
