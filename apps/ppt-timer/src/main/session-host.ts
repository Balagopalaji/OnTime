/**
 * Session host / app-state coordinator (ISSUE-001 H5, S-002/S-013/S-014/S-017/
 * S-027). Thin glue over the canonical capability — it does NOT reimplement
 * poll cadence, no-overlap, debounce/cache/clearing, helper restart, or timing
 * math. Those live in `@ontime/ppt-bridge` (client + session) and
 * `@ontime/presentation-core` (projection).
 *
 * Responsibilities:
 *  - build the transport: wrap `client.poll()` so the canonical affinity signal
 *    (S-012, H5-PRE) is captured before the session reduces the outcome.
 *  - own `PowerPointSession`, project each source-state transition to an
 *    immutable view, and publish it with a monotonic revision.
 *  - reproject on a remaining/elapsed toggle WITHOUT polling (S-014).
 *  - shut down idempotally: stop the session + close the helper exactly once.
 * The view never extrapolates between polls (S-017); an `unavailable` transition
 * clears numeric timing in the same published view (S-013).
 */
import {
  createPptBridgeClient,
  PowerPointSession,
  type BridgePollOutcome,
  type HelperLaunchCandidate,
  type PptBridgeClient,
  type PptBridgeClientOptions,
  type PowerPointSessionTransport,
} from '@ontime/ppt-bridge'
import { projectPowerPointView } from '@ontime/presentation-core'
import type { PresentationSourceState, PowerPointViewState } from '@ontime/presentation-core'
import type { TimingMode } from '../shared/ipc-contract.js'
import type { DiagnosticsBuffer } from './diagnostics.js'

export type HostView = { revision: number; state: PowerPointViewState }

export type SessionHostOptions = {
  candidates: readonly HelperLaunchCandidate[]
  pollIntervalMs?: number
  diagnostics?: DiagnosticsBuffer
  createClient?: (options: PptBridgeClientOptions) => PptBridgeClient
  onView?: (view: HostView) => void
}

export type SessionHost = {
  start(): void
  getView(): HostView
  setTimingMode(mode: TimingMode): void
  shutdown(): Promise<void>
}

/**
 * Derive the orthogonal multiple-instance warning from the latest outcome
 * (S-012). True only when the helper explicitly reports an affinity mismatch on
 * an attached observation; never inferred from instanceId churn. Reset to false
 * on not-running / failure / closed outcomes.
 */
export function deriveMultipleInstanceWarning(outcome: BridgePollOutcome | null): boolean {
  if (!outcome) return false
  if (outcome.kind === 'observation' || outcome.kind === 'no_slideshow') {
    return outcome.observation.affinityMismatch === true
  }
  return false
}

/** Pure projection used by both live transitions and timing-mode reprojection. */
export function projectHostView(
  source: PresentationSourceState,
  timingMode: TimingMode,
  multipleInstanceWarning: boolean,
): PowerPointViewState {
  return projectPowerPointView(source, { timingMode, multipleInstanceWarning })
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const diagnostics = options.diagnostics
  const createClient = options.createClient ?? createPptBridgeClient
  const onView = options.onView

  let revision = 0
  let timingMode: TimingMode = 'remaining'
  let multipleInstanceWarning = false
  let currentView: HostView = { revision, state: projectHostView({ kind: 'connecting' }, timingMode, false) }
  let lastKind: PresentationSourceState['kind'] | null = null
  let lastSlide: number | null | undefined = undefined
  let lastMediaCount: number | undefined = undefined
  let shutdownPromise: Promise<void> | null = null

  const client = createClient({
    executableCandidates: options.candidates,
    diagnostics: diagnostics?.asSink(),
  })

  const recordAffinity = (outcome: BridgePollOutcome | null): void => {
    if (!diagnostics) return
    if (outcome && (outcome.kind === 'observation' || outcome.kind === 'no_slideshow')) {
      const obs = outcome.observation
      diagnostics.push({
        kind: 'affinity',
        processCount: obs.processCount ?? null,
        selectedPid: obs.selectedPid ?? null,
        comPid: obs.comPid ?? null,
        mismatch: obs.affinityMismatch === true,
      })
    }
  }

  const recordTransition = (source: PresentationSourceState): void => {
    if (!diagnostics) return
    if (source.kind !== lastKind) {
      diagnostics.push({ kind: 'availability_transition', from: lastKind ?? 'connecting', to: source.kind })
      lastKind = source.kind
    }
    if (source.kind === 'presentation') {
      const snap = source.snapshot
      const slide = snap.slideNumber ?? null
      const mediaCount = snap.videos?.length ?? 0
      if (slide !== lastSlide || mediaCount !== lastMediaCount) {
        diagnostics.push({ kind: 'slide_observed', slideNumber: slide, mediaCount, selectedMediaId: null })
        lastSlide = slide
        lastMediaCount = mediaCount
      }
    }
  }

  const transport: PowerPointSessionTransport = {
    poll: async () => {
      const outcome = await client.poll()
      const next = deriveMultipleInstanceWarning(outcome)
      if (next !== multipleInstanceWarning) multipleInstanceWarning = next
      recordAffinity(outcome)
      return outcome
    },
    close: () => client.close(),
  }

  const session = new PowerPointSession({
    transport,
    pollIntervalMs,
    onTransition: (result) => {
      recordTransition(result.state.sourceState)
      publish(projectHostView(result.state.sourceState, timingMode, multipleInstanceWarning))
    },
  })

  const publish = (state: PowerPointViewState): void => {
    revision += 1
    currentView = { revision, state }
    onView?.(currentView)
  }

  const start = (): void => {
    publish(currentView.state) // initial connecting projection (S-001)
    void session.pollNow() // immediate first attempt
    session.start() // canonical 1s cadence; no-overlap/restart owned by session+client
  }

  const getView = (): HostView => currentView

  const setTimingMode = (mode: TimingMode): void => {
    if (mode === timingMode) return
    timingMode = mode
    // Reproject from the CURRENT session state without requesting a poll (S-014).
    publish(projectHostView(session.state.sourceState, timingMode, multipleInstanceWarning))
  }

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      // session.close() stops polling, then closes the transport (client.close),
      // which shuts the helper down. Both are idempotent; this memoizes once.
      await session.close()
    })()
    return shutdownPromise
  }

  return { start, getView, setTimingMode, shutdown }
}
