import { describe, expect, it } from 'vitest'
import { createInitialPowerPointMachineState, reducePowerPointMachine } from './powerpoint-machine'
import type { PowerPointMachineResult, PowerPointMachineState } from './powerpoint-machine'
import type { PowerPointPollResult } from './powerpoint-types'

/**
 * End-to-end reducer parity for the candidate/commit decision (C7-C16) and the
 * poll-status branch routing + clear behavior (D1, D2, D4, D6, D7, D8), ported
 * from the Companion oracles `main.presentation.test.ts` and
 * `main.ppt-status.test.ts`. The reducer takes `nowMs` explicitly, so no
 * `Date.now` stubbing is required. Pure normalization units (D3/D5/D9/D10/D11/
 * D12) are covered in `powerpoint-normalize.test.ts`.
 */

const T0 = 1_000_000
const DEBOUNCE = 600

const initial = (): PowerPointMachineState => createInitialPowerPointMachineState()

const poll = (
  state: PowerPointMachineState,
  result: PowerPointPollResult | null,
  nowMs: number,
): PowerPointMachineResult => reducePowerPointMachine(state, { type: 'poll', result, nowMs })

/** Baseline foreground running-slideshow poll (no video fields unless overridden). */
const fg = (instanceId: number, overrides: Partial<PowerPointPollResult> = {}): PowerPointPollResult => ({
  state: 'foreground',
  inSlideshow: true,
  instanceId,
  slideNumber: 1,
  totalSlides: 5,
  title: 'Deck',
  filename: 'deck.pptx',
  ...overrides,
})

/** Drive an announce through the debounce (poll at t0 and t0+600); returns the create result. */
const announce = (
  instanceId: number,
  t0: number,
  overrides: Partial<PowerPointPollResult> = {},
): PowerPointMachineResult => {
  const r1 = poll(initial(), fg(instanceId, overrides), t0)
  return poll(r1.state, fg(instanceId, overrides), t0 + DEBOUNCE)
}

const noAction = (r: PowerPointMachineResult) => expect(r.action).toBeNull()
const isCreate = (r: PowerPointMachineResult) => {
  expect(r.action?.kind).toBe('commit_snapshot')
  expect(r.action).toMatchObject({ classification: 'create' })
}

// ---------------------------------------------------------------------------
// C7 — first commit (create): debounced, activePresentation set, sourceState presentation
// ---------------------------------------------------------------------------
describe('C7 first commit', () => {
  it('create fires at t0+600; activePresentation set; sourceState is presentation', () => {
    const r0 = poll(initial(), fg(1, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 }), T0)
    noAction(r0)
    expect(r0.state.sourceState.kind).toBe('presentation')

    const r1 = poll(r0.state, fg(1, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 }), T0 + DEBOUNCE)
    isCreate(r1)
    expect(r1.state.announcedSnapshot?.instanceId).toBe(1)
    expect(r1.state.activePresentation).toEqual({ instanceId: 1 })
    expect(r1.state.sourceState.kind).toBe('presentation')
  })
})

// ---------------------------------------------------------------------------
// C8 — re-commit same instance (update): classification update, active preserved
// ---------------------------------------------------------------------------
describe('C8 re-commit same instance', () => {
  it('same identity + changed timing after announce -> update classification', () => {
    const announced = announce(1, T0, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000 })
    isCreate(announced)

    const updated = poll(
      announced.state,
      fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 2_000 }),
      T0 + DEBOUNCE + 1,
    )
    expect(updated.action).toMatchObject({ kind: 'commit_snapshot', classification: 'update' })
    expect(updated.state.activePresentation).toEqual({ instanceId: 1 })
  })
})

// ---------------------------------------------------------------------------
// C9 — different instance (replace): classification replace, active switches
// ---------------------------------------------------------------------------
describe('C9 different instance', () => {
  it('new instanceId after debounce -> replace classification', () => {
    const announced = announce(1, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    isCreate(announced)

    // identity change -> debounce restarts
    const r1 = poll(announced.state, fg(2, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 }), T0 + DEBOUNCE + 100)
    noAction(r1)
    const r2 = poll(r1.state, fg(2, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 }), T0 + 2 * DEBOUNCE + 100)
    expect(r2.action).toMatchObject({ kind: 'commit_snapshot', classification: 'replace' })
    expect(r2.state.activePresentation).toEqual({ instanceId: 2 })
  })
})

// ---------------------------------------------------------------------------
// C10 — commit_clear + repeat null is silent
// ---------------------------------------------------------------------------
describe('C10 commit clear', () => {
  it('none poll after announce debounces to commit_clear; repeat is silent', () => {
    const announced = announce(1, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    isCreate(announced)

    const r1 = poll(announced.state, { state: 'none' }, T0 + DEBOUNCE + 100)
    noAction(r1)
    expect(r1.state.sourceState.kind).toBe('powerpoint_not_running')

    const r2 = poll(r1.state, { state: 'none' }, T0 + 2 * DEBOUNCE + 100)
    expect(r2.action).toMatchObject({ kind: 'commit_clear', previousInstanceId: 1, hadActivePresentation: true })
    expect(r2.state.announcedSnapshot).toBeNull()
    expect(r2.state.activePresentation).toBeNull()

    const r3 = poll(r2.state, { state: 'none' }, T0 + 3 * DEBOUNCE + 100)
    noAction(r3)
  })
})

// ---------------------------------------------------------------------------
// C11 (package analog) — activePresentation ref tracks create/clear
// ---------------------------------------------------------------------------
describe('C11 activePresentation ref', () => {
  it('set on create, cleared on commit_clear', () => {
    const announced = announce(1, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    expect(announced.state.activePresentation).toEqual({ instanceId: 1 })
    const cleared = poll(announced.state, { state: 'none' }, T0 + DEBOUNCE + 100)
    const r2 = poll(cleared.state, { state: 'none' }, T0 + 2 * DEBOUNCE + 100)
    expect(r2.state.activePresentation).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// C12 — debounce boundary (strict <): 599 waits, 600 commits
// ---------------------------------------------------------------------------
describe('C12 debounce boundary', () => {
  const base = fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000 })

  it('no commit at t0 or t0+599; commit at t0+600', () => {
    const r0 = poll(initial(), base, T0)
    noAction(r0)
    const r599 = poll(r0.state, base, T0 + 599)
    noAction(r599)
    const r600 = poll(r599.state, base, T0 + 600)
    isCreate(r600)
  })
})

// ---------------------------------------------------------------------------
// C13 — timing change mid-debounce keeps the t0 anchor
// ---------------------------------------------------------------------------
describe('C13 timing change keeps anchor', () => {
  it('commit at t0+600 carries the new timing (anchor not reset)', () => {
    const x = fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoRemaining: 9_000 })
    const y = fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_300, videoRemaining: 8_700 })

    const r0 = poll(initial(), x, T0)
    const r300 = poll(r0.state, y, T0 + 300)
    noAction(r300)
    const r600 = poll(r300.state, y, T0 + 600)
    isCreate(r600)
    expect(r600.action?.kind === 'commit_snapshot' && r600.action.targetSnapshot.videoElapsed).toBe(1_300)
  })
})

// ---------------------------------------------------------------------------
// C14 — identity change resets the anchor
// ---------------------------------------------------------------------------
describe('C14 identity change resets anchor', () => {
  it('commit waits 600ms from the identity switch', () => {
    const a = fg(1, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    const b = fg(2, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })

    const r0 = poll(initial(), a, T0)
    const r500 = poll(r0.state, b, T0 + 500) // identity switch -> anchor resets to t0+500
    noAction(r500)
    const r900 = poll(r500.state, b, T0 + 900) // only 400ms after switch
    noAction(r900)
    const r1100 = poll(r900.state, b, T0 + 1_100) // 600ms after switch
    expect(r1100.action).toMatchObject({ kind: 'commit_snapshot', classification: 'create' })
    expect(r1100.action?.kind === 'commit_snapshot' && r1100.action.targetSnapshot.instanceId).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// C15 — announced fast path: timing changes commit immediately; identical is silent
// ---------------------------------------------------------------------------
describe('C15 announced fast path', () => {
  it('same identity + changed timing commits immediately; identical timing is silent', () => {
    const announced = announce(1, T0, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoRemaining: 9_000 })
    isCreate(announced)

    const immediate = poll(
      announced.state,
      fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 2_000, videoRemaining: 8_000 }),
      T0 + DEBOUNCE + 1,
    )
    expect(immediate.action).toMatchObject({ kind: 'commit_snapshot', classification: 'update' })

    const silent = poll(
      immediate.state,
      fg(1, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 2_000, videoRemaining: 8_000 }),
      T0 + DEBOUNCE + 2,
    )
    noAction(silent)
  })
})

// ---------------------------------------------------------------------------
// C16 — null no-op: with nothing announced, null polls never act
// ---------------------------------------------------------------------------
describe('C16 null no-op', () => {
  it('repeated none polls with announced null never act', () => {
    let s = initial()
    noAction(poll(s, { state: 'none' }, T0))
    s = poll(s, { state: 'none' }, T0).state
    noAction(poll(s, { state: 'none' }, T0 + 700))
    s = poll(s, { state: 'none' }, T0 + 700).state
    noAction(poll(s, { state: 'none' }, T0 + 1_400))
  })
})

// ---------------------------------------------------------------------------
// D1 — guards: null inert, foreground w/o instanceId inert, none debounced clear
// ---------------------------------------------------------------------------
describe('D1 guards', () => {
  it('null result is inert and leaves sourceState unchanged', () => {
    const s = initial()
    const r = poll(s, null, T0)
    noAction(r)
    expect(r.state).toBe(s) // unchanged, including sourceState stays 'connecting'
  })

  it('foreground without instanceId is inert', () => {
    const r = poll(initial(), { state: 'foreground' }, T0)
    noAction(r)
  })

  it('none with an announced snapshot debounces to commit_clear', () => {
    const announced = announce(7, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    isCreate(announced)
    const r1 = poll(announced.state, { state: 'none' }, T0 + DEBOUNCE + 1)
    noAction(r1)
    const r2 = poll(r1.state, { state: 'none' }, T0 + 2 * DEBOUNCE + 1)
    expect(r2.action?.kind).toBe('commit_clear')
  })
})

// ---------------------------------------------------------------------------
// D2 — inSlideshow === false: silent with nothing announced; debounced clear when announced
// ---------------------------------------------------------------------------
describe('D2 inSlideshow false', () => {
  it('silent with nothing announced; debounced commit_clear when announced', () => {
    const r0 = poll(initial(), fg(1, { inSlideshow: false }), T0)
    noAction(r0)
    expect(r0.state.sourceState.kind).toBe('no_slideshow')
    const r1 = poll(r0.state, fg(1, { inSlideshow: false }), T0 + 700)
    noAction(r1)

    const announced = announce(1, T0 + 1_000, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    isCreate(announced)
    const c1 = poll(announced.state, fg(1, { inSlideshow: false }), T0 + 1_000 + DEBOUNCE + 100)
    noAction(c1)
    const c2 = poll(c1.state, fg(1, { inSlideshow: false }), T0 + 1_000 + 2 * DEBOUNCE + 100)
    expect(c2.action?.kind).toBe('commit_clear')
  })
})

// ---------------------------------------------------------------------------
// D4 — slideNumber undefined falls back to the announced slide (same instance)
// ---------------------------------------------------------------------------
describe('D4 slideNumber fallback', () => {
  it('undefined slideNumber keeps announced slide 3 on a fast-path update', () => {
    const announced = announce(5, T0, {
      slideNumber: 3,
      videoDetected: true,
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: 1_000,
    })
    isCreate(announced)

    const update = poll(
      announced.state,
      fg(5, { slideNumber: undefined, videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_500 }),
      T0 + DEBOUNCE + 1,
    )
    expect(update.action?.kind).toBe('commit_snapshot')
    expect(update.action?.kind === 'commit_snapshot' && update.action.targetSnapshot.slideNumber).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// D6 — warm cache + no-payload polls: silent (cache retained, no two-poll clear)
// ---------------------------------------------------------------------------
describe('D6 warm cache silent', () => {
  it('no-payload polls on a warm cache never reach a commit_clear', () => {
    const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
    const announced = announce(1, T0, {
      videoDetected: true,
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videos: [V],
    })
    isCreate(announced)

    const r1 = poll(announced.state, fg(1), T0 + DEBOUNCE + 1)
    noAction(r1)
    // cache retained: latest observation still carries V
    expect(r1.state.sourceState.kind === 'presentation' && r1.state.sourceState.snapshot.videos).toEqual([V])

    const r2 = poll(r1.state, fg(1), T0 + DEBOUNCE + 2)
    noAction(r2)
  })
})

// ---------------------------------------------------------------------------
// D7 — explicitNoVideo: first poll keeps videos (timing dropped), second clears
// ---------------------------------------------------------------------------
describe('D7 explicitNoVideo two-poll clear', () => {
  it('first explicit keeps videos; second clears them', () => {
    const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: true }
    const announced = announce(1, T0, {
      videoDetected: true,
      videoPlaying: true,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videoRemaining: 9_000,
      videos: [V],
    })
    isCreate(announced)

    const e1 = poll(announced.state, fg(1, { videoDetected: false }), T0 + DEBOUNCE + 1)
    expect(e1.action?.kind).toBe('commit_snapshot')
    expect(e1.action?.kind === 'commit_snapshot' && e1.action.targetSnapshot.videos).toEqual([V])

    const e2 = poll(e1.state, fg(1, { videoDetected: false }), T0 + DEBOUNCE + 2)
    expect(e2.action?.kind === 'commit_snapshot' && e2.action.targetSnapshot.videos).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// D8 — slide change + explicitNoVideo clears immediately after the identity debounce
// ---------------------------------------------------------------------------
describe('D8 slide-change explicit clear', () => {
  it('slide 3 -> 4 explicit clears videos after the identity debounce', () => {
    const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
    const announced = announce(1, T0, {
      slideNumber: 3,
      videoDetected: true,
      videoPlaying: false,
      videoDuration: 10_000,
      videoElapsed: 1_000,
      videos: [V],
    })
    isCreate(announced)

    // identity change -> debounce
    const r1 = poll(announced.state, fg(1, { slideNumber: 4, videoDetected: false }), T0 + DEBOUNCE + 100)
    noAction(r1)
    const r2 = poll(r1.state, fg(1, { slideNumber: 4, videoDetected: false }), T0 + 2 * DEBOUNCE + 100)
    expect(r2.action?.kind === 'commit_snapshot' && r2.action.targetSnapshot.videos).toBeUndefined()
    expect(r2.action?.kind === 'commit_snapshot' && r2.action.targetSnapshot.slideNumber).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// operational_failure + reset
// ---------------------------------------------------------------------------
describe('operational_failure and reset', () => {
  it('operational_failure sets sourceState unavailable and preserves cache/announced', () => {
    const announced = announce(1, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    const failed = reducePowerPointMachine(announced.state, { type: 'operational_failure' })
    noAction(failed)
    expect(failed.state.sourceState.kind).toBe('unavailable')
    expect(failed.state.announcedSnapshot).not.toBeNull() // preserved for recovery
  })

  it('reset returns a fresh initial state', () => {
    const announced = announce(1, T0, { videoDetected: true, videoDuration: 10_000, videoElapsed: 1_000 })
    const reset = reducePowerPointMachine(announced.state, { type: 'reset' })
    noAction(reset)
    expect(reset.state).toEqual(createInitialPowerPointMachineState())
  })
})
