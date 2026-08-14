/**
 * Standalone multi-video focus tracker (ISSUE-001).
 *
 * The COM probe is stateless and the shared projection (`powerpoint-view.ts`) is
 * pure/clock-less, so "most recently started" cannot be derived at either
 * layer. This host-owned module is the one place that remembers which videos
 * have started and in what order. It is expressed as PURE functions over an
 * explicit state object so every rule below is unit-testable in isolation;
 * `session-host.ts` owns the mutable instance and feeds each presentation
 * transition through `applyFocusTransition`, then passes the resulting
 * `playOrder` map into `projectPowerPointView`.
 *
 * Rules (pinned by focus-tracker.test.ts and session-host.test.ts):
 *  - focus = most-recently-started video still playing; if it ends, the next
 *    most-recently-started still-playing video wins (no explicit "advance").
 *  - a video is counted as "started" the first poll its resolved status becomes
 *    'playing' (a contradictory `playing` flag never starts an ended video).
 *  - cold start with >=1 already-playing video: the lowest-elapsed playing
 *    video wins; ties break by shape order. Ranks are seeded so this falls out
 *    of the same "highest rank still playing" rule the projection enforces.
 *  - reset the entire history when the PowerPoint instance or slide changes.
 *    This scope check is NOT the whole reset contract: it cannot see an
 *    interruption that returns to the same instance + slide (slideshow
 *    stop/restart, a transient COM failure, helper crash/recovery). The host
 *    covers those by discarding the tracker outright on any non-presentation
 *    transition — see `session-host.ts` `onTransition` (P0-1).
 *  - ranks may remain after playback stops, but standalone headline selection
 *    ignores them until playback resumes and returns to helper next-to-play.
 *
 * This module imports no Electron/Node builtins and performs no I/O; it is safe
 * to unit-test in isolation with plain data.
 */
import { resolveVideoStatus } from '@ontime/presentation-core'
import type { PresentationVideo } from '@ontime/presentation-core'

// Status/end inference comes from the ONE canonical resolver in
// presentation-core (`resolveVideoStatus`, imported above) — the same function
// the view projection uses for tile status, so the two layers cannot disagree
// on the rule or its 250 ms threshold (P2-1). Deliberately not re-exported
// under a tracker-local alias: consumers and tests import it from the package
// that owns it.

/** Standalone focus-tracker state. Replaced, never mutated, across transitions. */
export type FocusTrackerState = {
  instanceId: number | null
  slideNumber: number | null
  /** video id -> monotonic start rank (higher = more recent). */
  playOrder: ReadonlyMap<number, number>
  /** ids seen playing on the previous poll (transition detection). */
  prevPlayingIds: Set<number>
  /** monotonic sequence counter. */
  seq: number
  /** true until the first poll that ranks the cold-start playing set. */
  cold: boolean
}

export function initFocusTracker(): FocusTrackerState {
  return { instanceId: null, slideNumber: null, playOrder: new Map(), prevPlayingIds: new Set(), seq: 0, cold: true }
}

/**
 * Advance the focus tracker for one presentation observation. Pure: returns a
 * fresh state object, never mutates the input. When `instanceId`/`slideNumber`
 * differs from the tracked scope, history resets and the cold-start seeding
 * path runs against the new scope's playing set.
 */
export function applyFocusTransition(
  prev: FocusTrackerState,
  instanceId: number,
  slideNumber: number | undefined,
  videos: readonly PresentationVideo[],
): FocusTrackerState {
  const scopeChanged = prev.instanceId !== instanceId || prev.slideNumber !== (slideNumber ?? null)
  let playOrder: Map<number, number>
  let prevPlayingIds: Set<number>
  let seq: number
  let cold: boolean

  if (scopeChanged) {
    playOrder = new Map()
    prevPlayingIds = new Set()
    seq = 0
    cold = true
  } else {
    playOrder = new Map(prev.playOrder)
    prevPlayingIds = new Set(prev.prevPlayingIds)
    seq = prev.seq
    cold = prev.cold
  }

  // Current playing set, keyed off RESOLVED status (ended outranks a playing flag).
  const playingNow = new Set<number>()
  for (const v of videos) {
    if (v.id !== undefined && resolveVideoStatus(v) === 'playing') playingNow.add(v.id)
  }

  if (cold) {
    // Seed every currently-playing video so the steady-state "highest rank
    // still playing" rule applies from the very first poll. The cold-start
    // rule is "lowest elapsed wins, ties break by shape order (earlier shape
    // wins)", so sort winner-first (elapsed ASC, then ordinal ASC) and assign
    // the highest rank to the winner. A playing video with no elapsed is
    // treated as +inf so it loses to any video with a known low elapsed.
    const playing = videos
      .map((v, ordinal) => ({ v, ordinal }))
      .filter((e) => e.v.id !== undefined && resolveVideoStatus(e.v) === 'playing')
    if (playing.length > 0) {
      playing.sort((a, b) => {
        const ea = a.v.elapsed ?? Number.POSITIVE_INFINITY
        const eb = b.v.elapsed ?? Number.POSITIVE_INFINITY
        if (ea !== eb) return ea - eb // lowest elapsed first
        return a.ordinal - b.ordinal // earliest shape first (shape-order tie-break)
      })
      let rank = playing.length
      seq += playing.length
      for (const e of playing) {
        if (e.v.id !== undefined) {
          playOrder.set(e.v.id, rank)
          rank -= 1
        }
      }
    }
    cold = false
  } else {
    // Steady state: any id that newly transitioned to playing gets the next rank.
    for (const v of videos) {
      if (v.id !== undefined && playingNow.has(v.id) && !prevPlayingIds.has(v.id)) {
        seq += 1
        playOrder.set(v.id, seq)
      }
    }
    // Preserve ranks so a genuine resume is detected and ranked once. The
    // standalone projector ignores retained ranks while nothing is playing.
  }

  return {
    instanceId,
    slideNumber: slideNumber ?? null,
    playOrder,
    prevPlayingIds: playingNow,
    seq,
    cold,
  }
}
