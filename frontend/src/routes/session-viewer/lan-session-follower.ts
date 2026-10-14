// rebuild-target: app-internal (cloud-web session viewer)
import { parseRemoteSnapshotV1 } from '@ontime/remote-viewer-contracts'
import type { TimerDisplayModel } from '@ontime/timer-face'
import { createLanSnapshotController, type LanSnapshotTransport } from './lan-snapshot-adapter'

const CONNECTING: TimerDisplayModel = { connection: 'connecting', statusText: 'Connecting', timeText: '--:--', disclosureRows: [] }

/**
 * LAN viewers are keyed by room, not by session: the session ID is minted by
 * the local sidecar, so it is only known once Companion bootstraps (or
 * broadcasts) a snapshot. The follower owns the one admitted transport and
 * runs one `createLanSnapshotController` at a time for the session it learns
 * from the stream:
 *
 * - it starts following the first valid snapshot of the room;
 * - a snapshot of another session replaces the followed one only when it was
 *   published later (a bootstrap burst replays older cached sessions first; a
 *   late older envelope never flips the display back);
 * - the controller's `ended` / `access-ended` states are display states: the
 *   transport stays open after `ended`, so the next Share on this room is
 *   picked up, and is closed only on revoked access or `stop()`.
 *
 * Session-level reduction, freshness and projection stay in the controller
 * (the same reducer and projection as the cloud viewer).
 */
export function createLanSessionFollower(options: {
  roomId: string
  transport: LanSnapshotTransport
  now: () => number
  onDisplay: (display: TimerDisplayModel) => void
  /** The viewer credential was revoked/expired; the page should return to pairing. */
  onAccessEnded?: () => void
}) {
  const { roomId, transport, now, onDisplay } = options
  type Facade = {
    transport: LanSnapshotTransport
    connect(): void
    envelope(value: unknown): void
    accessEnded(): void
  }
  let current: { sessionId: string; publishedAtMs: number; controller: ReturnType<typeof createLanSnapshotController>; facade: Facade } | null = null
  let started = false
  let stopped = false
  let unsubscribers: Array<() => void> = []

  /** A per-session transport view: forwards the shared socket's events, never closes it. */
  function createFacade(): Facade {
    const connect = new Set<() => void>()
    const envelopes = new Set<(value: unknown) => void>()
    const access = new Set<() => void>()
    return {
      transport: {
        onConnect: (handler) => (connect.add(handler), () => void connect.delete(handler)),
        onEnvelope: (handler) => (envelopes.add(handler), () => void envelopes.delete(handler)),
        onAccessEnded: (handler) => (access.add(handler), () => void access.delete(handler)),
        close: () => undefined,
      },
      connect: () => connect.forEach((handler) => handler()),
      envelope: (value) => envelopes.forEach((handler) => handler(value)),
      accessEnded: () => access.forEach((handler) => handler()),
    }
  }

  function follow(sessionId: string, publishedAtMs: number): NonNullable<typeof current> {
    void current?.controller.stop()
    const facade = createFacade()
    const controller = createLanSnapshotController({ roomId, sessionId, transport: facade.transport, now, onDisplay })
    current = { sessionId, publishedAtMs, controller, facade }
    controller.start()
    return current
  }

  function receive(value: unknown): void {
    if (stopped || typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    if (record.roomId !== roomId) return
    if (record.type === 'REMOTE_SNAPSHOT') {
      const parsed = parseRemoteSnapshotV1(record.snapshot)
      if (!parsed.ok) return
      const { sessionId, publishedAtMs } = parsed.value
      if (current === null || (sessionId !== current.sessionId && publishedAtMs > current.publishedAtMs)) {
        follow(sessionId, publishedAtMs)
      } else if (sessionId !== current.sessionId) {
        return
      } else {
        current.publishedAtMs = Math.max(current.publishedAtMs, publishedAtMs)
      }
    }
    current?.facade.envelope(value)
  }

  function release(): void {
    if (stopped) return
    stopped = true
    for (const unsubscribe of unsubscribers) unsubscribe()
    unsubscribers = []
    void current?.controller.stop()
    current = null
    transport.close()
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      onDisplay(CONNECTING)
      unsubscribers = [
        transport.onConnect(() => current?.facade.connect()),
        transport.onEnvelope(receive),
        transport.onAccessEnded(() => {
          if (stopped) return
          current?.facade.accessEnded()
          options.onAccessEnded?.()
          release()
        }),
      ]
    },
    async stop(): Promise<void> {
      release()
    },
  }
}
