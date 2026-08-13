import { describe, expect, it } from 'vitest'
import { resolveVideoStatus } from '@ontime/presentation-core'
import type { PresentationVideo } from '@ontime/presentation-core'
import { applyFocusTransition, initFocusTracker, type FocusTrackerState } from './focus-tracker'

/**
 * Focused unit tests for the standalone multi-video focus tracker (ISSUE-001).
 * The tracker is a pure function over an explicit state object, so every rule
 * is pinned here without timers, transports, or the session host. The
 * end-to-end behavior (host wiring, projection) is covered by
 * session-host.test.ts; this file owns the tracker's own invariants.
 */

type PV = PresentationVideo

const playing = (id: number, elapsed: number, duration = 10_000): PV => ({
  id,
  name: `v${id}`,
  duration,
  elapsed,
  remaining: duration - elapsed,
  status: 'playing',
  playing: true,
})
const paused = (id: number, elapsed: number, duration = 10_000): PV => ({
  id,
  name: `v${id}`,
  duration,
  elapsed,
  remaining: duration - elapsed,
  status: 'paused',
  playing: false,
})

// The tracker has no resolver of its own: it consumes `resolveVideoStatus` from
// presentation-core, the same function the view projection uses for tile status
// (P2-1). These cases pin the rule the tracker depends on; the package that owns
// the resolver pins its use in the projection.
describe('resolveVideoStatus (canonical resolver the tracker consumes)', () => {
  it('ended outranks a contradictory playing flag', () => {
    expect(
      resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 10_000, remaining: 0, status: 'ended', playing: true }),
    ).toBe('ended')
  })

  it('infers ended from zero/negative remaining even without explicit status', () => {
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 10_000, remaining: 0 })).toBe('ended')
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 11_000, remaining: -1_000 })).toBe('ended')
  })

  it('infers ended from the 250 ms duration-elapsed threshold', () => {
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 9_800, remaining: 200 })).toBe('ended')
  })

  it('resolves playing from explicit status or the playing flag', () => {
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 1_000, status: 'playing' })).toBe('playing')
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 1_000, playing: true })).toBe('playing')
  })

  it('resolves paused for positive elapsed with no playing signal, and ready otherwise', () => {
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 1_000 })).toBe('paused')
    expect(resolveVideoStatus({ id: 1, duration: 10_000, elapsed: 0 })).toBe('ready')
    expect(resolveVideoStatus({ id: 1, duration: 10_000 })).toBe('ready')
  })

  // P2-1 pinned BEHAVIORALLY rather than by identity: the set of videos the
  // tracker treats as started/playing must be exactly the set the canonical
  // resolver calls 'playing'. A second, drifting copy of the end-inference rule
  // inside the tracker would break this even though both functions still exist.
  it('P2-1 the tracker playing set matches the canonical resolver exactly', () => {
    const videos: PV[] = [
      { id: 1, duration: 10_000, elapsed: 1_000, status: 'playing', playing: true }, // playing
      { id: 2, duration: 10_000, elapsed: 10_000, remaining: 0, status: 'ended', playing: true }, // ended wins
      { id: 3, duration: 10_000, elapsed: 9_900, remaining: 100, playing: true }, // ended via 250 ms rule
      { id: 4, duration: 10_000, elapsed: 2_000, status: 'paused' }, // paused
      { id: 5, duration: 10_000, playing: true }, // playing (no elapsed)
    ]
    const canonical = videos.filter((v) => resolveVideoStatus(v) === 'playing').map((v) => v.id as number)
    const tracked = [...applyFocusTransition(initFocusTracker(), 1, 5, videos).prevPlayingIds]
    expect(tracked.sort((a, b) => a - b)).toEqual(canonical)
    // Guard: the sample really does exercise both ended paths and paused, so
    // the agreement above is not vacuously true.
    expect(canonical).toEqual([1, 5])
  })
})

describe('initFocusTracker', () => {
  it('starts empty and cold', () => {
    const s = initFocusTracker()
    expect(s.instanceId).toBeNull()
    expect(s.slideNumber).toBeNull()
    expect(s.playOrder.size).toBe(0)
    expect(s.prevPlayingIds.size).toBe(0)
    expect(s.cold).toBe(true)
    expect(s.seq).toBe(0)
  })
})

describe('applyFocusTransition — cold start', () => {
  it('ranks the lowest-elapsed playing video highest', () => {
    const s = applyFocusTransition(initFocusTracker(), 1, 5, [
      playing(10, 4_000),
      playing(20, 1_000),
    ])
    expect((s.playOrder.get(20) ?? -1) > (s.playOrder.get(10) ?? -1)).toBe(true)
    expect(s.cold).toBe(false)
  })

  it('breaks an elapsed tie by shape order (earlier shape ranked higher)', () => {
    const s = applyFocusTransition(initFocusTracker(), 1, 5, [
      playing(10, 1_000),
      playing(20, 1_000),
    ])
    expect((s.playOrder.get(10) ?? -1) > (s.playOrder.get(20) ?? -1)).toBe(true)
  })

  it('leaves playOrder empty when nothing is playing on the first poll', () => {
    const s = applyFocusTransition(initFocusTracker(), 1, 5, [
      paused(10, 1_000),
      paused(20, 2_000),
    ])
    expect(s.playOrder.size).toBe(0)
    expect(s.cold).toBe(false) // cold only gates the first poll, not the presence of playing videos
  })
})

describe('applyFocusTransition — steady state', () => {
  it('ranks a newly playing video above all previously ranked videos', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000), paused(20, 0)])
    s = applyFocusTransition(s, 1, 5, [playing(10, 2_000), playing(20, 500)])
    expect((s.playOrder.get(20) ?? -1) > (s.playOrder.get(10) ?? -1)).toBe(true)
  })

  it('does not bump the rank of a video that was already playing', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    const rankBefore = s.playOrder.get(10)
    s = applyFocusTransition(s, 1, 5, [playing(10, 2_000)])
    expect(s.playOrder.get(10)).toBe(rankBefore)
  })

  it('does not start a video that reports ended with a contradictory playing flag', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    s = applyFocusTransition(s, 1, 5, [
      { id: 10, name: 'v10', duration: 10_000, elapsed: 10_000, remaining: 0, status: 'ended', playing: true },
    ])
    expect(s.prevPlayingIds.has(10)).toBe(false)
  })

  it('keeps ranks for paused/ended videos so the projection can retain the focus', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    const rankBefore = s.playOrder.get(10)
    // id 10 pauses -> its rank must persist (not be cleared) for retention.
    s = applyFocusTransition(s, 1, 5, [paused(10, 1_000)])
    expect(s.playOrder.get(10)).toBe(rankBefore)
    expect(s.prevPlayingIds.has(10)).toBe(false)
  })
})

describe('applyFocusTransition — reset', () => {
  it('resets history on slide change and re-seeds cold on the new scope', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    expect(s.playOrder.has(10)).toBe(true)
    s = applyFocusTransition(s, 1, 6, [playing(20, 1_000)])
    expect(s.playOrder.has(10)).toBe(false)
    expect(s.playOrder.has(20)).toBe(true)
    expect(s.cold).toBe(false)
  })

  it('resets history on instance change', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    s = applyFocusTransition(s, 2, 5, [playing(20, 1_000)])
    expect(s.playOrder.has(10)).toBe(false)
    expect(s.playOrder.has(20)).toBe(true)
  })

  it('treats a missing slideNumber as its own distinct scope (null vs number)', () => {
    let s = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    s = applyFocusTransition(s, 1, undefined, [playing(20, 1_000)])
    expect(s.playOrder.has(10)).toBe(false)
    expect(s.playOrder.has(20)).toBe(true)
    expect(s.slideNumber).toBeNull()
  })
})

describe('applyFocusTransition — purity', () => {
  it('never mutates the input state', () => {
    const initial = applyFocusTransition(initFocusTracker(), 1, 5, [playing(10, 1_000)])
    const snapshot: FocusTrackerState = {
      instanceId: initial.instanceId,
      slideNumber: initial.slideNumber,
      playOrder: new Map(initial.playOrder),
      prevPlayingIds: new Set(initial.prevPlayingIds),
      seq: initial.seq,
      cold: initial.cold,
    }
    applyFocusTransition(initial, 1, 5, [playing(10, 2_000), playing(20, 500)])
    expect(initial.playOrder).toEqual(snapshot.playOrder)
    expect(initial.seq).toBe(snapshot.seq)
    expect(initial.prevPlayingIds).toEqual(snapshot.prevPlayingIds)
    expect(initial.cold).toBe(snapshot.cold)
  })

  it('ignores videos without an id (never ranked, never tracked as playing)', () => {
    const s = applyFocusTransition(initFocusTracker(), 1, 5, [
      { name: 'no-id', duration: 10_000, elapsed: 1_000, status: 'playing', playing: true },
      playing(10, 1_000),
    ])
    expect(s.playOrder.size).toBe(1)
    expect(s.playOrder.has(10)).toBe(true)
  })
})
