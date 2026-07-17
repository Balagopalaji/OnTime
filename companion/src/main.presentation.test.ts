/**
 * Characterization tests for the PowerPoint presentation snapshot/debounce
 * machinery in main.ts (Stage 1b Lane B slice B-2, extraction-rules §8 step 2:
 * characterize before carving).
 *
 * Pins the CURRENT behavior of:
 *   - snapshotsIdentityEqual / snapshotsTimingEqual / videoListsEqual (pure)
 *   - buildPowerPointCue (pure except the process.platform darwin override)
 *   - commitPresentationSnapshot / updatePresentationCandidate (stateful
 *     candidate/commit machine over module state pptAnnouncedSnapshot,
 *     pptCandidateSnapshot, pptCandidateSince, pptActiveCue)
 *
 * Platform determinism: buildPowerPointCue forces
 * metadata.videoTimingUnavailable = true on darwin. Every test that reaches
 * buildPowerPointCue stubs process.platform explicitly (win32 unless the test
 * targets the darwin branch) so results are identical on macOS dev hosts and
 * Linux CI.
 *
 * State hygiene: module state persists across tests in this file. Each state
 * machine test (a) clears roomStateStore/roomClientStore, (b) calls
 * commitPresentationSnapshot(null) with zero rooms to silently reset
 * pptAnnouncedSnapshot/pptActiveCue, and (c) uses a fresh instanceId so any
 * stale pptCandidateSnapshot identity can never match.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

type VideoTiming = {
  id?: number
  name?: string
  duration?: number
  elapsed?: number
  remaining?: number
  playing?: boolean
}

type Snapshot = {
  instanceId: number
  slideNumber?: number
  totalSlides?: number
  title: string
  filename?: string
  videoPlaying?: boolean
  videoDuration?: number
  videoElapsed?: number
  videoRemaining?: number
  videos?: VideoTiming[]
  videoTimingUnavailable?: boolean
}

const loadHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-presentation-tests'
  return import('./main.js')
}

type EmitEntry = { roomId: string; event: string; payload: any }

/** Capture emits by pushing a fake io server. Resets the server list first. */
function attachEmitterCapture(m: any): EmitEntry[] {
  const emitted: EmitEntry[] = []
  m.ioServers.length = 0
  m.ioServers.push({
    to: (r: string) => ({ emit: (event: string, payload: any) => emitted.push({ roomId: r, event, payload }) }),
  })
  return emitted
}

/** Stub Date.now with a mutable clock for the duration of `fn`; always restore. */
async function withMutableNow<T>(initial: number, fn: (setNow: (t: number) => void) => Promise<T> | T): Promise<T> {
  const realNow = Date.now
  let current = initial
  Date.now = () => current
  try {
    return await fn((t) => {
      current = t
    })
  } finally {
    Date.now = realNow
  }
}

/** Stub process.platform for the duration of `fn`; always restore. */
async function withPlatform<T>(platform: string, fn: () => Promise<T> | T): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

/** Reset the presentation machine: no rooms → commit(null) emits nothing but
 *  clears pptAnnouncedSnapshot + pptActiveCue. Stale candidate state is
 *  neutralized by fresh per-test instanceIds. */
function resetPresentation(m: any) {
  m.ioServers.length = 0
  m.roomStateStore.clear()
  m.roomClientStore.clear()
  m.commitPresentationSnapshot(null)
}

function seedRoom(m: any, roomId: string) {
  m.roomStateStore.set(roomId, {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: 0,
    activeLiveCueId: undefined,
    showClock: false,
  })
}

const CUE_EVENTS = new Set([
  'LIVE_CUE_CREATED',
  'LIVE_CUE_UPDATED',
  'LIVE_CUE_ENDED',
  'PRESENTATION_LOADED',
  'PRESENTATION_UPDATE',
  'PRESENTATION_CLEAR',
])

/** Drop ROOM_STATE_DELTA noise (updateRoomActiveLiveCueId side channel). */
const cueEmits = (log: EmitEntry[]) => log.filter((e) => CUE_EVENTS.has(e.event))

let instanceSeq = 9000
const nextInstanceId = () => ++instanceSeq

/** Fully specified snapshot (explicit videoRemaining so no derivation kicks in). */
function makeSnapshot(instanceId: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    instanceId,
    slideNumber: 1,
    totalSlides: 5,
    title: `Deck ${instanceId}`,
    filename: 'deck.pptx',
    videoPlaying: false,
    videoDuration: 10_000,
    videoElapsed: 1_000,
    videoRemaining: 9_000,
    videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }],
    videoTimingUnavailable: false,
    ...overrides,
  }
}

/** Expected cue for a fully specified snapshot (videoRemaining explicit). */
function pptCue(snap: Snapshot, startedAt: number, status: 'playing' | 'ended' = 'playing') {
  return {
    id: `powerpoint:${snap.instanceId}`,
    source: 'powerpoint',
    title: snap.title,
    startedAt,
    status,
    metadata: {
      slideNumber: snap.slideNumber,
      totalSlides: snap.totalSlides,
      filename: snap.filename,
      player: 'powerpoint',
      instanceId: snap.instanceId,
      videoPlaying: snap.videoPlaying,
      videoDuration: snap.videoDuration,
      videoElapsed: snap.videoElapsed,
      videoRemaining: snap.videoRemaining,
      videos: snap.videos,
      videoTimingUnavailable: snap.videoTimingUnavailable,
    },
  }
}

// ---------------------------------------------------------------------------
// C1 — snapshotsIdentityEqual: identity fields only, timing ignored
// ---------------------------------------------------------------------------
test('C1 snapshotsIdentityEqual: null handling, per-field identity compare, timing ignored', async () => {
  const m = await loadHelpers()
  const eq = m.snapshotsIdentityEqual as (a: Snapshot | null, b: Snapshot | null) => boolean

  const base = (): Snapshot => ({
    instanceId: 7,
    slideNumber: 2,
    totalSlides: 9,
    title: 'Deck',
    filename: 'deck.pptx',
    videoElapsed: 100,
  })

  // Null handling.
  assert.equal(eq(null, null), true)
  assert.equal(eq(base(), null), false)
  assert.equal(eq(null, base()), false)

  // Each identity field differing alone → false.
  assert.equal(eq(base(), { ...base(), instanceId: 8 }), false)
  assert.equal(eq(base(), { ...base(), slideNumber: 3 }), false)
  assert.equal(eq(base(), { ...base(), totalSlides: 10 }), false)
  assert.equal(eq(base(), { ...base(), title: 'Other' }), false)
  assert.equal(eq(base(), { ...base(), filename: 'other.pptx' }), false)

  // All identity fields equal → true (distinct object refs).
  assert.equal(eq(base(), base()), true)

  // Equal with optional identity fields undefined on both sides → true.
  assert.equal(eq({ instanceId: 7, title: 'Deck' }, { instanceId: 7, title: 'Deck' }), true)

  // Timing fields differing → STILL true (identity compare ignores timing).
  assert.equal(
    eq(base(), {
      ...base(),
      videoPlaying: true,
      videoDuration: 5_000,
      videoElapsed: 999,
      videoRemaining: 1,
      videos: [{ id: 1 }],
      videoTimingUnavailable: true,
    }),
    true,
  )
})

// ---------------------------------------------------------------------------
// C2 — snapshotsTimingEqual: timing fields only, identity ignored
// ---------------------------------------------------------------------------
test('C2 snapshotsTimingEqual: per-field timing compare incl. videos, identity ignored', async () => {
  const m = await loadHelpers()
  const eq = m.snapshotsTimingEqual as (a: Snapshot | null, b: Snapshot | null) => boolean

  const base = (): Snapshot => ({
    instanceId: 7,
    title: 'Deck',
    videoPlaying: true,
    videoDuration: 10_000,
    videoElapsed: 4_000,
    videoRemaining: 6_000,
    videoTimingUnavailable: false,
    videos: [{ id: 1, name: 'v', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }],
  })

  // Null handling mirrors identityEqual.
  assert.equal(eq(null, null), true)
  assert.equal(eq(base(), null), false)

  // Each timing field differing alone → false.
  assert.equal(eq(base(), { ...base(), videoPlaying: false }), false)
  assert.equal(eq(base(), { ...base(), videoDuration: 10_001 }), false)
  assert.equal(eq(base(), { ...base(), videoElapsed: 4_001 }), false)
  assert.equal(eq(base(), { ...base(), videoRemaining: 5_999 }), false)
  assert.equal(eq(base(), { ...base(), videoTimingUnavailable: true }), false)

  // videos list difference → false.
  assert.equal(
    eq(base(), { ...base(), videos: [{ id: 2, name: 'v', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }] }),
    false,
  )

  // All timing fields equal (distinct refs, distinct nested video objects) → true.
  assert.equal(eq(base(), base()), true)

  // Identity fields differing → STILL true (timing compare ignores identity).
  assert.equal(
    eq(base(), { ...base(), instanceId: 99, slideNumber: 5, totalSlides: 50, title: 'X', filename: 'x.pptx' }),
    true,
  )
})

// ---------------------------------------------------------------------------
// C3 — videoListsEqual: undefined handling, length, per-field per-index compare
// ---------------------------------------------------------------------------
test('C3 videoListsEqual: undefined/length handling and per-field compare at each index', async () => {
  const m = await loadHelpers()
  const eq = m.videoListsEqual as (a?: VideoTiming[], b?: VideoTiming[]) => boolean

  const v = (): VideoTiming => ({ id: 1, name: 'v', duration: 100, elapsed: 40, remaining: 60, playing: true })
  const w = (): VideoTiming => ({ id: 2, name: 'w', duration: 200, elapsed: 50, remaining: 150, playing: false })

  // Undefined handling.
  assert.equal(eq(undefined, undefined), true)
  assert.equal(eq([v()], undefined), false)
  assert.equal(eq(undefined, [v()]), false)

  // Length mismatch → false.
  assert.equal(eq([v()], [v(), w()]), false)

  // Each field differing at index 1 (not index 0) → false; pins the loop
  // walking past the first element AND every compared field.
  assert.equal(eq([v(), w()], [v(), { ...w(), id: 3 }]), false)
  assert.equal(eq([v(), w()], [v(), { ...w(), name: 'x' }]), false)
  assert.equal(eq([v(), w()], [v(), { ...w(), duration: 201 }]), false)
  assert.equal(eq([v(), w()], [v(), { ...w(), elapsed: 51 }]), false)
  assert.equal(eq([v(), w()], [v(), { ...w(), remaining: 151 }]), false)
  assert.equal(eq([v(), w()], [v(), { ...w(), playing: true }]), false)

  // Equal non-empty lists with distinct object refs → true.
  assert.equal(eq([v(), w()], [v(), w()]), true)

  // Two distinct empty arrays → true.
  assert.equal(eq([], []), true)
})

// ---------------------------------------------------------------------------
// C4 — buildPowerPointCue: full field mapping (platform win32)
// ---------------------------------------------------------------------------
test('C4 buildPowerPointCue: whole-cue mapping, explicit videoRemaining wins over derived', async () => {
  const m = await loadHelpers()
  await withPlatform('win32', () => {
    const snap: Snapshot = {
      instanceId: 42,
      slideNumber: 3,
      totalSlides: 12,
      title: 'Quarterly Deck',
      filename: 'q.pptx',
      videoPlaying: true,
      videoDuration: 10_000,
      videoElapsed: 4_000,
      videoRemaining: 5_500, // explicit, deliberately != 10000-4000
      videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }],
      videoTimingUnavailable: false,
    }

    const cue = m.buildPowerPointCue(snap, 111_222)

    assert.deepStrictEqual(cue, {
      id: 'powerpoint:42',
      source: 'powerpoint',
      title: 'Quarterly Deck',
      startedAt: 111_222,
      status: 'playing',
      metadata: {
        slideNumber: 3,
        totalSlides: 12,
        filename: 'q.pptx',
        player: 'powerpoint',
        instanceId: 42,
        videoPlaying: true,
        videoDuration: 10_000,
        videoElapsed: 4_000,
        videoRemaining: 5_500, // explicit value wins over derived 6_000
        videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 4_000, remaining: 6_000, playing: true }],
        videoTimingUnavailable: false,
      },
    })
  })
})

// ---------------------------------------------------------------------------
// C5 — buildPowerPointCue: derived videoRemaining (platform win32)
// ---------------------------------------------------------------------------
test('C5 buildPowerPointCue: videoRemaining derived from duration-elapsed only when both present', async () => {
  const m = await loadHelpers()
  await withPlatform('win32', () => {
    const base: Snapshot = { instanceId: 1, title: 'T' }

    // remaining undefined + duration + elapsed → derived duration - elapsed.
    assert.strictEqual(
      m.buildPowerPointCue({ ...base, videoDuration: 10_000, videoElapsed: 4_000 }, 0).metadata!.videoRemaining,
      6_000,
    )

    // Explicit remaining wins over derived.
    assert.strictEqual(
      m.buildPowerPointCue({ ...base, videoDuration: 10_000, videoElapsed: 4_000, videoRemaining: 2_500 }, 0).metadata!
        .videoRemaining,
      2_500,
    )

    // Duration missing → undefined.
    assert.strictEqual(m.buildPowerPointCue({ ...base, videoElapsed: 4_000 }, 0).metadata!.videoRemaining, undefined)

    // Elapsed missing → undefined.
    assert.strictEqual(m.buildPowerPointCue({ ...base, videoDuration: 10_000 }, 0).metadata!.videoRemaining, undefined)
  })
})

// ---------------------------------------------------------------------------
// C6 — buildPowerPointCue: darwin override vs win32 passthrough
// ---------------------------------------------------------------------------
test('C6 buildPowerPointCue: darwin forces videoTimingUnavailable=true; win32 passes through', async () => {
  const m = await loadHelpers()
  const snapFalse: Snapshot = { instanceId: 5, title: 'T', videoTimingUnavailable: false }
  const snapUndef: Snapshot = { instanceId: 5, title: 'T' }

  await withPlatform('darwin', () => {
    assert.strictEqual(m.buildPowerPointCue(snapFalse, 0).metadata!.videoTimingUnavailable, true)
    assert.strictEqual(m.buildPowerPointCue(snapUndef, 0).metadata!.videoTimingUnavailable, true)
  })

  await withPlatform('win32', () => {
    assert.strictEqual(m.buildPowerPointCue(snapFalse, 0).metadata!.videoTimingUnavailable, false)
    assert.strictEqual(m.buildPowerPointCue(snapUndef, 0).metadata!.videoTimingUnavailable, undefined)
  })
})

// ---------------------------------------------------------------------------
// C7 — commit: first commit fans out CREATED then LOADED to every room
// ---------------------------------------------------------------------------
test('C7 commit first snapshot: LIVE_CUE_CREATED then PRESENTATION_LOADED per room, startedAt = now', async () => {
  const m = await loadHelpers()
  const NOW = 1_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(NOW, () => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      seedRoom(m, 'room-b')
      const emitted = attachEmitterCapture(m)

      const snap = makeSnapshot(id)
      m.commitPresentationSnapshot(snap)

      const cue = pptCue(snap, NOW)
      assert.deepStrictEqual(cueEmits(emitted), [
        { roomId: 'room-a', event: 'LIVE_CUE_CREATED', payload: { type: 'LIVE_CUE_CREATED', roomId: 'room-a', cue, timestamp: NOW } },
        { roomId: 'room-a', event: 'PRESENTATION_LOADED', payload: { type: 'PRESENTATION_LOADED', roomId: 'room-a', cue, timestamp: NOW } },
        { roomId: 'room-b', event: 'LIVE_CUE_CREATED', payload: { type: 'LIVE_CUE_CREATED', roomId: 'room-b', cue, timestamp: NOW } },
        { roomId: 'room-b', event: 'PRESENTATION_LOADED', payload: { type: 'PRESENTATION_LOADED', roomId: 'room-b', cue, timestamp: NOW } },
      ])
    }),
  )
})

// ---------------------------------------------------------------------------
// C8 — commit: re-commit same instanceId → UPDATED/UPDATE, startedAt preserved
// ---------------------------------------------------------------------------
test('C8 re-commit same instanceId: LIVE_CUE_UPDATED + PRESENTATION_UPDATE, startedAt preserved from first commit', async () => {
  const m = await loadHelpers()
  const T0 = 2_000_000
  const T1 = 2_007_500
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      m.commitPresentationSnapshot(makeSnapshot(id))
      emitted.length = 0

      setNow(T1)
      const changed = makeSnapshot(id, {
        videoPlaying: true,
        videoElapsed: 2_000,
        videoRemaining: 8_000,
        videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 2_000, remaining: 8_000, playing: true }],
      })
      m.commitPresentationSnapshot(changed)

      // startedAt stays T0 (NOT the new now); payload timestamps are T1.
      const cue = pptCue(changed, T0)
      assert.deepStrictEqual(cueEmits(emitted), [
        { roomId: 'room-a', event: 'LIVE_CUE_UPDATED', payload: { type: 'LIVE_CUE_UPDATED', roomId: 'room-a', cue, timestamp: T1 } },
        { roomId: 'room-a', event: 'PRESENTATION_UPDATE', payload: { type: 'PRESENTATION_UPDATE', roomId: 'room-a', cue, timestamp: T1 } },
      ])
    }),
  )
})

// ---------------------------------------------------------------------------
// C9 — commit: different instanceId → ENDED for old (all rooms first), then
//      CREATED + LOADED for the new cue
// ---------------------------------------------------------------------------
test('C9 different instanceId: ENDED (old cue, all rooms) precedes CREATED+LOADED (new cue), new startedAt', async () => {
  const m = await loadHelpers()
  const T0 = 3_000_000
  const T1 = 3_010_000
  const oldId = nextInstanceId()
  const newId = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      seedRoom(m, 'room-b')
      const emitted = attachEmitterCapture(m)

      const oldSnap = makeSnapshot(oldId)
      m.commitPresentationSnapshot(oldSnap)
      emitted.length = 0

      setNow(T1)
      const newSnap = makeSnapshot(newId)
      m.commitPresentationSnapshot(newSnap)

      // Old cue re-emitted intact except status flipped to 'ended'.
      const endedCue = pptCue(oldSnap, T0, 'ended')
      const newCue = pptCue(newSnap, T1)
      assert.deepStrictEqual(cueEmits(emitted), [
        // ENDED fan-out completes for ALL rooms before any CREATED.
        { roomId: 'room-a', event: 'LIVE_CUE_ENDED', payload: { type: 'LIVE_CUE_ENDED', roomId: 'room-a', cue: endedCue, timestamp: T1 } },
        { roomId: 'room-b', event: 'LIVE_CUE_ENDED', payload: { type: 'LIVE_CUE_ENDED', roomId: 'room-b', cue: endedCue, timestamp: T1 } },
        { roomId: 'room-a', event: 'LIVE_CUE_CREATED', payload: { type: 'LIVE_CUE_CREATED', roomId: 'room-a', cue: newCue, timestamp: T1 } },
        { roomId: 'room-a', event: 'PRESENTATION_LOADED', payload: { type: 'PRESENTATION_LOADED', roomId: 'room-a', cue: newCue, timestamp: T1 } },
        { roomId: 'room-b', event: 'LIVE_CUE_CREATED', payload: { type: 'LIVE_CUE_CREATED', roomId: 'room-b', cue: newCue, timestamp: T1 } },
        { roomId: 'room-b', event: 'PRESENTATION_LOADED', payload: { type: 'PRESENTATION_LOADED', roomId: 'room-b', cue: newCue, timestamp: T1 } },
      ])
    }),
  )
})

// ---------------------------------------------------------------------------
// C10 — commit null: ENDED + CLEAR interleaved per room; second null is silent
// ---------------------------------------------------------------------------
test('C10 commit null: ENDED then PRESENTATION_CLEAR per room (interleaved); repeat null emits nothing', async () => {
  const m = await loadHelpers()
  const T0 = 4_000_000
  const T1 = 4_020_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      seedRoom(m, 'room-b')
      const emitted = attachEmitterCapture(m)

      const snap = makeSnapshot(id)
      m.commitPresentationSnapshot(snap)
      emitted.length = 0

      setNow(T1)
      m.commitPresentationSnapshot(null)

      const endedCue = pptCue(snap, T0, 'ended')
      const cueId = `powerpoint:${id}`
      // Unlike the instance-switch path (C9), the null path interleaves
      // ENDED/CLEAR per room in a single pass.
      assert.deepStrictEqual(cueEmits(emitted), [
        { roomId: 'room-a', event: 'LIVE_CUE_ENDED', payload: { type: 'LIVE_CUE_ENDED', roomId: 'room-a', cue: endedCue, timestamp: T1 } },
        { roomId: 'room-a', event: 'PRESENTATION_CLEAR', payload: { type: 'PRESENTATION_CLEAR', roomId: 'room-a', cueId, timestamp: T1 } },
        { roomId: 'room-b', event: 'LIVE_CUE_ENDED', payload: { type: 'LIVE_CUE_ENDED', roomId: 'room-b', cue: endedCue, timestamp: T1 } },
        { roomId: 'room-b', event: 'PRESENTATION_CLEAR', payload: { type: 'PRESENTATION_CLEAR', roomId: 'room-b', cueId, timestamp: T1 } },
      ])

      // Second null commit: announced already null → completely silent
      // (no cue events AND no ROOM_STATE_DELTA).
      emitted.length = 0
      m.commitPresentationSnapshot(null)
      assert.equal(emitted.length, 0)
    }),
  )
})

// ---------------------------------------------------------------------------
// C11 — commit side effect on roomStateStore.activeLiveCueId
// ---------------------------------------------------------------------------
test('C11 activeLiveCueId side effect: set to powerpoint:<id> on create, undefined after null commit', async () => {
  const m = await loadHelpers()
  const T0 = 5_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, () => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      attachEmitterCapture(m)

      m.commitPresentationSnapshot(makeSnapshot(id))
      assert.strictEqual(m.roomStateStore.get('room-a')!.activeLiveCueId, `powerpoint:${id}`)

      m.commitPresentationSnapshot(null)
      // Cleared to undefined (NOT null): updateRoomActiveLiveCueId stores
      // `activeLiveCueId ?? undefined`.
      assert.strictEqual(m.roomStateStore.get('room-a')!.activeLiveCueId, undefined)
    }),
  )
})

// ---------------------------------------------------------------------------
// C12 — updatePresentationCandidate: 600ms debounce boundary (strict <)
// ---------------------------------------------------------------------------
test('C12 debounce boundary: no commit at t0 or t0+599; commit fires exactly at t0+600', async () => {
  const m = await loadHelpers()
  const T0 = 6_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      m.updatePresentationCandidate(makeSnapshot(id))
      assert.equal(emitted.length, 0, 'no emits at t0')

      setNow(T0 + 599)
      m.updatePresentationCandidate(makeSnapshot(id))
      assert.equal(emitted.length, 0, 'no emits at t0+599 (still inside the 600ms debounce)')

      setNow(T0 + 600)
      m.updatePresentationCandidate(makeSnapshot(id))
      const events = cueEmits(emitted).map((e) => e.event)
      assert.deepStrictEqual(events, ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'], 'commit fires exactly at t0+600')
    }),
  )
})

// ---------------------------------------------------------------------------
// C13 — timing change during debounce updates content WITHOUT resetting anchor
// ---------------------------------------------------------------------------
test('C13 timing change mid-debounce keeps the t0 anchor; commit at t0+600 carries the new timing', async () => {
  const m = await loadHelpers()
  const T0 = 7_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      const timingY: Partial<Snapshot> = {
        videoElapsed: 1_300,
        videoRemaining: 8_700,
        videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 1_300, remaining: 8_700, playing: false }],
      }

      m.updatePresentationCandidate(makeSnapshot(id)) // timing X at t0
      setNow(T0 + 300)
      m.updatePresentationCandidate(makeSnapshot(id, timingY)) // same identity, timing Y
      assert.equal(emitted.length, 0, 'timing-only change mid-debounce emits nothing')

      // If the timing change HAD reset the anchor to t0+300, t0+600 would
      // still be inside the debounce and this would not commit.
      setNow(T0 + 600)
      m.updatePresentationCandidate(makeSnapshot(id, timingY))
      const created = cueEmits(emitted)
      assert.deepStrictEqual(created.map((e) => e.event), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.strictEqual(created[0].payload.cue.metadata.videoElapsed, 1_300)
      assert.strictEqual(created[0].payload.cue.metadata!.videoRemaining, 8_700)
    }),
  )
})

// ---------------------------------------------------------------------------
// C14 — identity change DOES reset the debounce anchor
// ---------------------------------------------------------------------------
test('C14 identity change resets the anchor: commit waits 600ms from the identity switch', async () => {
  const m = await loadHelpers()
  const T0 = 8_000_000
  const idA = nextInstanceId()
  const idB = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      m.updatePresentationCandidate(makeSnapshot(idA)) // identity A at t0

      setNow(T0 + 500)
      m.updatePresentationCandidate(makeSnapshot(idB)) // identity B → anchor resets to t0+500
      assert.equal(emitted.length, 0)

      // t0+900 is 900ms after A's anchor but only 400ms after B's — if the
      // identity switch had NOT reset the anchor this would commit.
      setNow(T0 + 900)
      m.updatePresentationCandidate(makeSnapshot(idB))
      assert.equal(emitted.length, 0, 'no commit 400ms after the identity switch')

      setNow(T0 + 1_100) // 600ms after the switch
      m.updatePresentationCandidate(makeSnapshot(idB))
      const created = cueEmits(emitted)
      assert.deepStrictEqual(created.map((e) => e.event), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.strictEqual(created[0].payload.cue.id, `powerpoint:${idB}`)
    }),
  )
})

// ---------------------------------------------------------------------------
// C15 — announced fast path: timing changes commit immediately, no debounce
// ---------------------------------------------------------------------------
test('C15 announced fast path: same identity + changed timing commits immediately; identical timing emits nothing', async () => {
  const m = await loadHelpers()
  const T0 = 9_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      // Announce via the normal debounce path (commit lands at t0+600).
      m.updatePresentationCandidate(makeSnapshot(id))
      setNow(T0 + 600)
      m.updatePresentationCandidate(makeSnapshot(id))
      assert.deepStrictEqual(cueEmits(emitted).map((e) => e.event), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // Same identity + changed timing 1ms later → IMMEDIATE update commit.
      setNow(T0 + 601)
      const changed = makeSnapshot(id, {
        videoPlaying: true,
        videoElapsed: 2_000,
        videoRemaining: 8_000,
        videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 2_000, remaining: 8_000, playing: true }],
      })
      m.updatePresentationCandidate(changed)
      // startedAt preserved from the t0+600 create; timestamps are t0+601.
      const cue = pptCue(changed, T0 + 600)
      assert.deepStrictEqual(cueEmits(emitted), [
        { roomId: 'room-a', event: 'LIVE_CUE_UPDATED', payload: { type: 'LIVE_CUE_UPDATED', roomId: 'room-a', cue, timestamp: T0 + 601 } },
        { roomId: 'room-a', event: 'PRESENTATION_UPDATE', payload: { type: 'PRESENTATION_UPDATE', roomId: 'room-a', cue, timestamp: T0 + 601 } },
      ])

      // Same identity + identical timing → zero emits of any kind.
      emitted.length = 0
      setNow(T0 + 602)
      m.updatePresentationCandidate(makeSnapshot(id, {
        videoPlaying: true,
        videoElapsed: 2_000,
        videoRemaining: 8_000,
        videos: [{ id: 1, name: 'clip', duration: 10_000, elapsed: 2_000, remaining: 8_000, playing: true }],
      }))
      assert.equal(emitted.length, 0)
    }),
  )
})

// ---------------------------------------------------------------------------
// C16 — null no-op: with nothing announced, null updates never emit
// ---------------------------------------------------------------------------
test('C16 null no-op: repeated updatePresentationCandidate(null) with announced null emits nothing', async () => {
  const m = await loadHelpers()
  const T0 = 10_000_000
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      m.updatePresentationCandidate(null)
      setNow(T0 + 700) // past the 600ms debounce
      m.updatePresentationCandidate(null)
      setNow(T0 + 1_400)
      m.updatePresentationCandidate(null)

      assert.equal(emitted.length, 0)
    }),
  )
})
