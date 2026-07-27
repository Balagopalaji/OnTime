/**
 * Pure, time-injected PowerPoint candidate/commit state machine. Graduated
 * from `companion/src/presentation-candidate.ts` (H3, ISSUE-001): the
 * poll-status branch routing + normalization (via `normalizePowerPointPoll`)
 * and the 600 ms identity-debounce candidate decision, expressed as a single
 * synchronous reducer over explicit state. Behavior is pinned by the Companion
 * oracles `main.presentation.test.ts` (C7-C16) and `main.ppt-status.test.ts`
 * (D1-D12).
 *
 * Nothing host-specific lives here: no `setInterval`, no `Date.now`, no
 * `process`, no transport, no LiveCue, no room emission. The host owns
 * scheduling, timestamps (passed in as `nowMs`), and side effects (driven by
 * the returned `action`). The guardrail bans all such references in production.
 */
import type {
  ActivePresentationRef,
  PresentationSnapshot,
  PresentationSourceState,
  PresentationVideo,
  PowerPointPollResult,
} from './powerpoint-types'
import {
  POWERPOINT_DEBOUNCE_MS,
  normalizePowerPointPoll,
  snapshotsIdentityEqual,
  snapshotsTimingEqual,
} from './powerpoint-normalize'

// Re-exported for the unified public surface so hosts import canonical
// constants from the package barrel rather than redeclaring them.
export { POWERPOINT_DEBOUNCE_MS, POWERPOINT_VIDEO_CLEAR_POLLS, POWERPOINT_PLAYING_DELTA_MS } from './powerpoint-normalize'

/**
 * Immutable machine state. The host reads `sourceState` for immediate display
 * and applies `action` (if any) for debounced Companion live-cue commits.
 * Maps/arrays/snapshots are replaced, never mutated in place.
 */
export type PowerPointMachineState = {
  videoCache: ReadonlyMap<string, PresentationVideo[]>
  noVideoKey: string | null
  noVideoCount: number
  explicitNoVideoKey: string | null
  explicitNoVideoCount: number
  announcedSnapshot: PresentationSnapshot | null
  candidateSnapshot: PresentationSnapshot | null
  candidateSinceMs: number
  activePresentation: ActivePresentationRef | null
  sourceState: PresentationSourceState
}

/** Closed event union. `poll` with a null result is the inert Companion outcome. */
export type PowerPointMachineEvent =
  | { type: 'poll'; result: PowerPointPollResult | null; nowMs: number }
  | { type: 'operational_failure' }
  | { type: 'reset' }

/**
 * Decision-only action. Carries an advisory lifecycle classification so the
 * full transition is testable; in H4 the Companion adapter feeds only the
 * target snapshot (or null) into the existing `commitPresentationSnapshot`.
 * There is no room/LiveCue payload and no async acknowledgement in H3.
 */
export type PresentationMachineAction =
  | {
      kind: 'commit_snapshot'
      classification: 'create' | 'update' | 'replace'
      targetSnapshot: PresentationSnapshot
    }
  | {
      kind: 'commit_clear'
      previousInstanceId: number
      hadActivePresentation: boolean
    }

export type PowerPointMachineResult = {
  state: PowerPointMachineState
  action: PresentationMachineAction | null
}

/**
 * Fresh initial state. `candidateSinceMs` starts at 0 (matching the Companion
 * module init) and `sourceState` starts at `connecting`.
 */
export function createInitialPowerPointMachineState(): PowerPointMachineState {
  return {
    videoCache: new Map(),
    noVideoKey: null,
    noVideoCount: 0,
    explicitNoVideoKey: null,
    explicitNoVideoCount: 0,
    announcedSnapshot: null,
    candidateSnapshot: null,
    candidateSinceMs: 0,
    activePresentation: null,
    sourceState: { kind: 'connecting' },
  }
}

/**
 * Reduce one event. Synchronous and pure. `state.sourceState` is the immediate
 * display observation; `action` is the debounced Companion commit decision
 * (or null). The host must serialize reducer calls and supply a monotonic-ish
 * `nowMs` (a backwards clock simply keeps the candidate inside the debounce).
 */
/**
 * Candidate/commit decision. Verbatim port of Companion's
 * `updatePresentationCandidate`, with `Date.now()` replaced by the injected
 * `nowMs` and the commit replaced by a decision-only `action`. The candidate
 * snapshot/timestamp are NOT reset on commit (matching Companion module
 * behavior); only `announcedSnapshot`/`activePresentation` advance.
 */
function applyCandidate(
  state: PowerPointMachineState,
  snapshot: PresentationSnapshot | null,
  nowMs: number,
): PowerPointMachineResult {
  // Announced fast path: same identity commits a timing change immediately.
  if (state.announcedSnapshot && snapshotsIdentityEqual(snapshot, state.announcedSnapshot)) {
    // identity-equal to a non-null announced => snapshot is non-null.
    if (snapshot !== null && !snapshotsTimingEqual(snapshot, state.announcedSnapshot)) {
      return {
        state: { ...state, announcedSnapshot: snapshot },
        action: { kind: 'commit_snapshot', classification: 'update', targetSnapshot: snapshot },
      }
    }
    return { state, action: null }
  }

  // Track candidate identity/timing. The anchor resets ONLY on identity change;
  // a timing-only change updates content but keeps `candidateSinceMs`.
  let candidateSnapshot = state.candidateSnapshot
  let candidateSinceMs = state.candidateSinceMs
  if (!snapshotsIdentityEqual(snapshot, candidateSnapshot)) {
    candidateSnapshot = snapshot
    candidateSinceMs = nowMs
  } else if (!snapshotsTimingEqual(snapshot, candidateSnapshot)) {
    candidateSnapshot = snapshot
  }
  const tracked: PowerPointMachineState = { ...state, candidateSnapshot, candidateSinceMs }

  if (nowMs - candidateSinceMs < POWERPOINT_DEBOUNCE_MS) {
    return { state: tracked, action: null }
  }
  if (snapshotsIdentityEqual(snapshot, state.announcedSnapshot)) {
    return { state: tracked, action: null }
  }

  // Debounce satisfied and identity differs from announced -> commit.
  if (snapshot !== null) {
    const classification: 'create' | 'update' | 'replace' = !state.activePresentation
      ? 'create'
      : state.activePresentation.instanceId === snapshot.instanceId
        ? 'update'
        : 'replace'
    return {
      state: {
        ...tracked,
        announcedSnapshot: snapshot,
        activePresentation: { instanceId: snapshot.instanceId },
      },
      action: { kind: 'commit_snapshot', classification, targetSnapshot: snapshot },
    }
  }

  // snapshot === null: clear, but only if something is announced.
  if (!state.announcedSnapshot) {
    return { state: tracked, action: null }
  }
  return {
    state: { ...tracked, announcedSnapshot: null, activePresentation: null },
    action: {
      kind: 'commit_clear',
      previousInstanceId: state.announcedSnapshot.instanceId,
      hadActivePresentation: state.activePresentation !== null,
    },
  }
}

/**
 * Reduce one event. Synchronous and pure. `state.sourceState` is the immediate
 * display observation; `action` is the debounced Companion commit decision
 * (or null). The host must serialize reducer calls and supply a monotonic-ish
 * `nowMs` (a backwards clock simply keeps the candidate inside the debounce).
 */
export function reducePowerPointMachine(
  state: PowerPointMachineState,
  event: PowerPointMachineEvent,
): PowerPointMachineResult {
  if (event.type === 'reset') {
    return { state: createInitialPowerPointMachineState(), action: null }
  }
  if (event.type === 'operational_failure') {
    // Only the display observation changes; cache/announced/counters stay for
    // canonical recovery. Same-reduction removal of visible numeric timing.
    return { state: { ...state, sourceState: { kind: 'unavailable' } }, action: null }
  }

  // event.type === 'poll'
  const { result, nowMs } = event
  // null result is inert (NOT an operational failure).
  if (result === null) {
    return { state, action: null }
  }
  if (result.state === 'none') {
    return applyCandidate({ ...state, sourceState: { kind: 'powerpoint_not_running' } }, null, nowMs)
  }
  if (result.state === 'foreground' || result.state === 'background') {
    // Missing instanceId: ignore completely, retain prior sourceState (D1).
    if (!result.instanceId) {
      return { state, action: null }
    }
    if (result.inSlideshow === false) {
      // Companion only feeds a no-slideshow clear into the candidate machine
      // when a presentation was already announced; a pending candidate is
      // intentionally preserved across this transient observation.
      if (!state.announcedSnapshot) {
        return { state: { ...state, sourceState: { kind: 'no_slideshow' } }, action: null }
      }
      return applyCandidate({ ...state, sourceState: { kind: 'no_slideshow' } }, null, nowMs)
    }
    const normalized = normalizePowerPointPoll({
      // The `!result.instanceId` guard above guarantees instanceId is a number
      // here; TS does not carry that property narrowing into the whole-object
      // argument, so the assertion is the honest post-guard refinement.
      result: result as PowerPointPollResult & { instanceId: number },
      announced: state.announcedSnapshot,
      videoCache: state.videoCache,
      noVideoKey: state.noVideoKey,
      noVideoCount: state.noVideoCount,
      explicitNoVideoKey: state.explicitNoVideoKey,
      explicitNoVideoCount: state.explicitNoVideoCount,
    })
    const nextState: PowerPointMachineState = {
      ...state,
      sourceState: { kind: 'presentation', snapshot: normalized.snapshot },
      videoCache: normalized.videoCache,
      noVideoKey: normalized.noVideoKey,
      noVideoCount: normalized.noVideoCount,
      explicitNoVideoKey: normalized.explicitNoVideoKey,
      explicitNoVideoCount: normalized.explicitNoVideoCount,
    }
    return applyCandidate(nextState, normalized.snapshot, nowMs)
  }

  // result.state is foreground/background/none — all branches above return.
  // Defensive inert for any unforeseen value.
  return { state, action: null }
}
