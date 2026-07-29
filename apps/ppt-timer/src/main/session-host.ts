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
import { applyFocusTransition, initFocusTracker } from './focus-tracker.js'

export type HostView = { revision: number; state: PowerPointViewState }

export type SessionHostOptions = {
  candidates: readonly HelperLaunchCandidate[]
  pollIntervalMs?: number
  /** Persisted setting applied before the first connecting projection or poll. */
  timingMode?: TimingMode
  diagnostics?: DiagnosticsBuffer
  createClient?: (options: PptBridgeClientOptions) => PptBridgeClient
  onView?: (view: HostView) => void
}

export type SessionHost = {
  start(): void
  getView(): HostView
  setTimingMode(mode: TimingMode): void
  /** Validated helper protocol version from the latest observation (S-026, D-2); null until one arrives or after a terminal / no-signal outcome. */
  getProtocolVersion(): number | null
  /** Helper product version emitted by the native payload; null until observed. */
  getHelperVersion(): string | null
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

/**
 * Derive app-local safe diagnostics metadata from the latest outcome (S-026,
 * D-1/D-2). Carries the canonical helper-emitted selected-media identity
 * (`primaryVideoId`) and protocol version straight through — it never chooses a
 * video and never recomputes the projection's `selectPrimaryVideo` rules; it
 * only forwards what the helper already emitted. Both fields are numeric, so the
 * S-025 redaction guarantee (no raw video names / titles / contents) holds.
 *
 * Both clear to null on terminal / no-signal outcomes — anything that does not
 * carry an observation (not-running, COM-unavailable, failure, closed, null) —
 * so a stale media id or protocol version from a defunct slideshow can never
 * reach the diagnostics report. `no_slideshow` still carries an observation, so
 * a reported protocol version survives it while the media id clears naturally
 * (no video is active).
 */
export function deriveObservationMeta(outcome: BridgePollOutcome | null): {
  selectedMediaId: number | null
  selectedMediaIndex: number | null
  protocolVersion: number | null
  productVersion: string | null
} {
  if (outcome && (outcome.kind === 'observation' || outcome.kind === 'no_slideshow')) {
    const observation = outcome.observation
    return {
      selectedMediaId: observation.primaryVideoId ?? null,
      selectedMediaIndex: observation.primaryVideoIndex ?? null,
      protocolVersion: observation.protocolVersion ?? null,
      productVersion: observation.productVersion ?? null,
    }
  }
  return { selectedMediaId: null, selectedMediaIndex: null, protocolVersion: null, productVersion: null }
}

/** Pure projection used by both live transitions and timing-mode reprojection. */
export function projectHostView(
  source: PresentationSourceState,
  timingMode: TimingMode,
  multipleInstanceWarning: boolean,
  playOrder?: ReadonlyMap<number, number>,
): PowerPointViewState {
  return projectPowerPointView(source, { timingMode, multipleInstanceWarning, playOrder })
}

// Standalone multi-video focus tracker (ISSUE-001): the pure recency rules live
// in `./focus-tracker` (carved out to stay under the production-file line cap);
// `createSessionHost` owns the stateful instance and feeds each transition
// through it below.

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  const diagnostics = options.diagnostics
  const createClient = options.createClient ?? createPptBridgeClient
  const onView = options.onView

  let revision = 0
  let timingMode: TimingMode = options.timingMode ?? 'remaining'
  let multipleInstanceWarning = false
  let currentView: HostView = { revision, state: projectHostView({ kind: 'connecting' }, timingMode, false) }
  let lastKind: PresentationSourceState['kind'] | null = null
  let lastSlide: number | null | undefined = undefined
  let lastMediaCount: number | undefined = undefined
  // Diagnostics selection identity is read from the normalized snapshot so a
  // warm-cached video list and its helper-owned primary remain one unit.
  let diagnosticsMediaId: number | null = null
  let diagnosticsMediaIndex: number | null = null
  let lastProtocolVersion: number | null = null
  let lastHelperVersion: string | null = null
  let shutdownPromise: Promise<void> | null = null
  // Standalone multi-video focus history (ISSUE-001). Updated from the session
  // transition before projection so the focus-aware projection sees the latest
  // recency ranking. Reset is driven by the tracker's scope check (instanceId /
  // slideNumber), independent of diagnostics bookkeeping above.
  let focus = initFocusTracker()

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
      const selectedMediaId = snap.primaryVideoId ?? null
      const selectedMediaIndex = snap.primaryVideoIndex ?? null
      if (
        slide !== lastSlide ||
        mediaCount !== lastMediaCount ||
        selectedMediaId !== diagnosticsMediaId ||
        selectedMediaIndex !== diagnosticsMediaIndex
      ) {
        diagnostics.push({
          kind: 'slide_observed',
          slideNumber: slide,
          mediaCount,
          selectedMediaId,
          selectedMediaIndex,
        })
        lastSlide = slide
        lastMediaCount = mediaCount
        diagnosticsMediaId = selectedMediaId
        diagnosticsMediaIndex = selectedMediaIndex
      }
    }
  }

  const transport: PowerPointSessionTransport = {
    poll: async () => {
      const outcome = await client.poll()
      const next = deriveMultipleInstanceWarning(outcome)
      if (next !== multipleInstanceWarning) multipleInstanceWarning = next
      // Track the latest validated protocol version for the diagnostics header.
      // Selection identity is recorded from the normalized snapshot below.
      const meta = deriveObservationMeta(outcome)
      lastProtocolVersion = meta.protocolVersion
      lastHelperVersion = meta.productVersion
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
      const source = result.state.sourceState
      // Advance the focus tracker for presentation observations. EVERY other
      // source kind resets the history (P0-1): the reducer can emit
      // `unavailable` / `powerpoint_not_running` / `no_slideshow` on the SAME
      // instance + slide (slideshow stop/restart, a transient COM failure, or a
      // helper crash/recovery), so the tracker's scope-change check alone would
      // NOT fire and stale ranks would survive the interruption. Resetting here
      // means the post-recovery presentation re-enters the cold-start path and
      // re-applies the lowest-elapsed / shape-order rule. The projection ignores
      // playOrder for non-presentation kinds anyway, so the reset has no visible
      // effect until the next presentation arrives.
      if (source.kind === 'presentation') {
        focus = applyFocusTransition(
          focus,
          source.snapshot.instanceId,
          source.snapshot.slideNumber,
          source.snapshot.videos ?? [],
        )
      } else {
        focus = initFocusTracker()
      }
      publish(projectHostView(source, timingMode, multipleInstanceWarning, focus.playOrder))
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

  const getProtocolVersion = (): number | null => lastProtocolVersion

  const getHelperVersion = (): string | null => lastHelperVersion

  const setTimingMode = (mode: TimingMode): void => {
    if (mode === timingMode) return
    timingMode = mode
    // Reproject from the CURRENT session state without requesting a poll (S-014).
    // Focus history is reused so the selected video stays stable across a toggle.
    publish(projectHostView(session.state.sourceState, timingMode, multipleInstanceWarning, focus.playOrder))
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

  return { start, getView, setTimingMode, getProtocolVersion, getHelperVersion, shutdown }
}
