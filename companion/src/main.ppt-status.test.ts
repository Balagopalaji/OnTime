/**
 * Characterization tests for handlePowerPointStatus in main.ts (Stage 1b
 * Lane B slice B-4, extraction-rules §8 step 2: characterize before carving).
 *
 * handlePowerPointStatus is the decision core of PowerPoint detection: it maps
 * a raw PowerPointPollResult into a PresentationSnapshot (title fallback,
 * slide-number persistence, video source priority, per-slide video cache with
 * two-poll clear counters, playing-detection enrichment, timing-field fallback
 * to the announced snapshot) and feeds updatePresentationCandidate. The
 * candidate/commit machine itself is already pinned by
 * main.presentation.test.ts C7–C16; these tests decode the built snapshot
 * through the committed cue payloads (cue metadata mapping pinned by C4).
 *
 * Observation technique:
 *   - Cold start: call handlePowerPointStatus(result) at t0 and again with the
 *     same result at t0+600 → the LIVE_CUE_CREATED payload reveals the built
 *     snapshot (600ms debounce, strict <, pinned by C12).
 *   - After a snapshot is ANNOUNCED, a poll whose snapshot keeps the same
 *     identity but changes timing commits IMMEDIATELY (announced fast path,
 *     C15) → each poll's effect is visible in the LIVE_CUE_UPDATED payload
 *     (or in silence when the built snapshot is timing-identical).
 *   - Identity changes (e.g. slideNumber) go back through the 600ms debounce.
 *
 * Platform determinism: buildPowerPointCue forces
 * metadata.videoTimingUnavailable = true on darwin, so every test stubs
 * process.platform to win32.
 *
 * State hygiene: module state persists across tests in this file
 * (pptVideoCache, pptNoVideoKey/Count, pptExplicitNoVideoKey/Count,
 * pptAnnouncedSnapshot, candidate state). Each test (a) clears the room
 * stores, (b) calls commitPresentationSnapshot(null) with zero rooms to
 * silently reset announced state, and (c) uses fresh instanceIds so slideKeys
 * (`instanceId:slide`) and candidate identities never collide across tests.
 *
 * DIVERGENCE PINNED AS-IS (see D6): with a WARM per-slide cache, a poll with
 * no video payload at all refills `videos` from the cache BEFORE
 * hasVideoPayload is computed, so hasVideoPayload is true, the no-video
 * counter resets, timing fields carry forward from the announced snapshot,
 * and the poll is completely silent — the two-poll keep-then-clear staging
 * never occurs on the warm-cache path. Only the explicitNoVideo counter
 * (D7) and the slide-change+explicit path (D8) actually clear a warm cache.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const loadHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-ppt-status-tests'
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
 *  clears pptAnnouncedSnapshot + pptActiveCue. Stale candidate/cache/counter
 *  state is neutralized by fresh per-test instanceIds (fresh slideKeys). */
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
const cueEventNames = (log: EmitEntry[]) => cueEmits(log).map((e) => e.event)

let instanceSeq = 20_000
const nextInstanceId = () => ++instanceSeq

/** Baseline foreground poll result (no video fields unless overridden). */
function fg(instanceId: number, overrides: Record<string, any> = {}): any {
  return {
    state: 'foreground',
    inSlideshow: true,
    instanceId,
    slideNumber: 1,
    totalSlides: 5,
    title: 'Deck',
    filename: 'deck.pptx',
    ...overrides,
  }
}

/** Expected committed cue metadata for an fg() poll (all 11 keys, C4 shape). */
function cueMeta(instanceId: number, overrides: Record<string, any> = {}) {
  return {
    slideNumber: 1,
    totalSlides: 5,
    filename: 'deck.pptx',
    player: 'powerpoint',
    instanceId,
    videoPlaying: undefined,
    videoDuration: undefined,
    videoElapsed: undefined,
    videoRemaining: undefined,
    videos: undefined,
    videoTimingUnavailable: false,
    ...overrides,
  }
}

/** Drive an announce through the debounce: same result at t0 and t0+600. */
function announceTwice(m: any, setNow: (t: number) => void, t0: number, result: any) {
  setNow(t0)
  m.handlePowerPointStatus(result)
  setNow(t0 + 600)
  m.handlePowerPointStatus(result)
}

// ---------------------------------------------------------------------------
// D1 — null / 'none' / missing-instanceId guards
// ---------------------------------------------------------------------------
test('D1 guards: null is inert, foreground without instanceId returns early, none clears via debounce', async () => {
  const m = await loadHelpers()
  const T0 = 1_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      // null result → zero emits of any kind.
      m.handlePowerPointStatus(null)
      assert.equal(emitted.length, 0, 'null result emits nothing')

      // A later announce is unaffected by the null: normal debounced create.
      const announce = fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000 })
      announceTwice(m, setNow, T0, announce)
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoRemaining: 9_000 }),
      )
      emitted.length = 0

      // foreground with NO instanceId → early return, no emits.
      setNow(T0 + 601)
      m.handlePowerPointStatus({ state: 'foreground' })
      assert.equal(emitted.length, 0, 'foreground without instanceId emits nothing')

      // Announced state unchanged: an identical-to-announced poll stays
      // silent (fast path with identical timing → no commit).
      setNow(T0 + 602)
      m.handlePowerPointStatus(announce)
      assert.equal(emitted.length, 0, 'identical-to-announced poll is silent')

      // state 'none' with an announced snapshot → debounced clear:
      // first none silent, second none 600ms later emits ENDED + CLEAR.
      setNow(T0 + 700)
      m.handlePowerPointStatus({ state: 'none' })
      assert.equal(emitted.length, 0, 'first none is silent (inside debounce)')

      setNow(T0 + 1_300)
      m.handlePowerPointStatus({ state: 'none' })
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_ENDED', 'PRESENTATION_CLEAR'])
      assert.strictEqual(cueEmits(emitted)[0].payload.cue.id, `powerpoint:${id}`)
      assert.strictEqual(cueEmits(emitted)[0].payload.cue.status, 'ended')
      assert.strictEqual(cueEmits(emitted)[1].payload.cueId, `powerpoint:${id}`)
    }),
  )
})

// ---------------------------------------------------------------------------
// D2 — inSlideshow === false
// ---------------------------------------------------------------------------
test('D2 inSlideshow=false: silent with nothing announced; debounced ENDED+CLEAR when announced', async () => {
  const m = await loadHelpers()
  const T0 = 2_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      // Nothing announced → inSlideshow:false never emits, even past 600ms.
      m.handlePowerPointStatus(fg(id, { inSlideshow: false }))
      setNow(T0 + 700)
      m.handlePowerPointStatus(fg(id, { inSlideshow: false }))
      assert.equal(emitted.length, 0, 'inSlideshow=false with nothing announced never emits')

      // Announce, then two inSlideshow:false polls 600ms apart → clear.
      const announce = fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000 })
      announceTwice(m, setNow, T0 + 1_000, announce)
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      setNow(T0 + 1_700)
      m.handlePowerPointStatus(fg(id, { inSlideshow: false }))
      assert.equal(emitted.length, 0, 'first inSlideshow=false after announce is silent (debounce)')

      setNow(T0 + 2_300)
      m.handlePowerPointStatus(fg(id, { inSlideshow: false }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_ENDED', 'PRESENTATION_CLEAR'])
      assert.strictEqual(cueEmits(emitted)[1].payload.cueId, `powerpoint:${id}`)
    }),
  )
})

// ---------------------------------------------------------------------------
// D3 — title fallback chain: title → filename → 'PowerPoint'
// ---------------------------------------------------------------------------
test('D3 title fallback: whitespace title falls to filename, both blank fall to PowerPoint, title wins', async () => {
  const m = await loadHelpers()
  const T0 = 3_000_000
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      const cases: Array<{ title: string | undefined; filename: string | undefined; expected: string }> = [
        { title: '  ', filename: 'deck.pptx', expected: 'deck.pptx' },
        { title: undefined, filename: '   ', expected: 'PowerPoint' },
        { title: 'My Deck', filename: 'deck.pptx', expected: 'My Deck' },
      ]
      cases.forEach((c, i) => {
        resetPresentation(m)
        seedRoom(m, 'room-a')
        const emitted = attachEmitterCapture(m)
        const id = nextInstanceId()
        announceTwice(m, setNow, T0 + i * 10_000, fg(id, { title: c.title, filename: c.filename }))
        assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
        assert.strictEqual(cueEmits(emitted)[0].payload.cue.title, c.expected, `case ${i}: ${c.expected}`)
      })
    }),
  )
})

// ---------------------------------------------------------------------------
// D4 — slide-number persistence: undefined slideNumber falls back to announced
// ---------------------------------------------------------------------------
test('D4 slideNumber undefined falls back to announced slide of the same instance', async () => {
  const m = await loadHelpers()
  const T0 = 4_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      announceTwice(
        m,
        setNow,
        T0,
        fg(id, { slideNumber: 3, videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000 }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // slideNumber undefined + a timing change → immediate fast-path commit
      // whose metadata keeps the announced slide 3 (same slideKey I:3).
      setNow(T0 + 601)
      m.handlePowerPointStatus(
        fg(id, { slideNumber: undefined, videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_500 }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { slideNumber: 3, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_500, videoRemaining: 8_500 }),
      )
    }),
  )
})

// ---------------------------------------------------------------------------
// D5 — video source priority: videos > editSlideVideos > per-slide cache
// ---------------------------------------------------------------------------
test('D5 video source priority: result.videos wins, then editSlideVideos, then cache', async () => {
  const m = await loadHelpers()
  const T0 = 5_000_000
  const id = nextInstanceId()
  const VA = { id: 1, name: 'a', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
  const VB = { id: 2, name: 'b', duration: 5_000, elapsed: 1_000, remaining: 4_000, playing: false }
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      // Both lists present → result.videos wins (also caches [VA] under I:1).
      announceTwice(
        m,
        setNow,
        T0,
        fg(id, {
          videoDetected: true,
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_000,
          videos: [VA],
          editSlideVideos: [VB],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoRemaining: 9_000, videos: [VA] }),
      )
      emitted.length = 0

      // videos absent → editSlideVideos used (replaces the cache with [VB]).
      setNow(T0 + 601)
      m.handlePowerPointStatus(
        fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_100, editSlideVideos: [VB] }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_100, videoRemaining: 8_900, videos: [VB] }),
      )
      emitted.length = 0

      // Both lists absent, not explicitNoVideo → cache used ([VB]).
      setNow(T0 + 602)
      m.handlePowerPointStatus(fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_200 }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_200, videoRemaining: 8_800, videos: [VB] }),
      )
    }),
  )
})

// ---------------------------------------------------------------------------
// D6 — warm cache + no-payload polls: DIVERGES from the two-poll keep/clear
//      staging. The cache refill runs BEFORE hasVideoPayload is computed, so
//      hasVideoPayload stays true, the no-video counter resets every poll,
//      timing carries forward from the announced snapshot, and the polls are
//      completely silent; the cache is never cleared on this path.
// ---------------------------------------------------------------------------
test('D6 warm cache + no-payload polls: silent forever, cache retained (no two-poll clear)', async () => {
  const m = await loadHelpers()
  const T0 = 6_000_000
  const id = nextInstanceId()
  const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      // Announce with videos V → caches V under I:1.
      announceTwice(
        m,
        setNow,
        T0,
        fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videos: [V] }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // Poll 2: NO video payload at all → cache refills `videos`, timing
      // fields fall back to the announced snapshot → timing-identical →
      // completely silent (NOT the described keep-with-dropped-timing commit).
      setNow(T0 + 601)
      m.handlePowerPointStatus(fg(id))
      assert.equal(emitted.length, 0, 'no-payload poll with warm cache is silent')

      // Poll 3: still silent — the counter reset each poll, so the
      // PPT_VIDEO_CLEAR_POLLS threshold is never reached with a warm cache.
      setNow(T0 + 602)
      m.handlePowerPointStatus(fg(id))
      assert.equal(emitted.length, 0, 'second no-payload poll also silent, no clear')

      // Cache proof: a timing-change poll with no lists still resolves V from
      // the cache — it was never cleared.
      setNow(T0 + 603)
      m.handlePowerPointStatus(fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 2_000 }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: false, videoDuration: 10_000, videoElapsed: 2_000, videoRemaining: 8_000, videos: [V] }),
      )
    }),
  )
})

// ---------------------------------------------------------------------------
// D7 — explicitNoVideo two-poll clear: first explicit poll drops the timing
//      fields but KEEPS videos (immediate commit); the second clears videos.
// ---------------------------------------------------------------------------
test('D7 explicitNoVideo: first poll keeps videos (timing dropped), second poll clears them', async () => {
  const m = await loadHelpers()
  const T0 = 7_000_000
  const id = nextInstanceId()
  const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: true }
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      announceTwice(
        m,
        setNow,
        T0,
        fg(id, {
          videoDetected: true,
          videoPlaying: true,
          videoDuration: 10_000,
          videoElapsed: 1_000,
          videoRemaining: 9_000,
          videos: [V],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // Explicit no-video poll #1: videoDetected:false with no timing fields
      // and no lists → NOT silent: immediate UPDATE that keeps videos [V] via
      // the prior-snapshot fallback while all timing fields go undefined.
      setNow(T0 + 601)
      m.handlePowerPointStatus(fg(id, { videoDetected: false }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata, cueMeta(id, { videos: [V] }))
      emitted.length = 0

      // Explicit no-video poll #2 (consecutive, same slideKey) → hits
      // PPT_VIDEO_CLEAR_POLLS=2 → videos cleared to undefined.
      setNow(T0 + 602)
      m.handlePowerPointStatus(fg(id, { videoDetected: false }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata, cueMeta(id))
    }),
  )
})

// ---------------------------------------------------------------------------
// D8 — slide change + explicitNoVideo → clear without the two-poll wait
//      (identity change still goes through the 600ms debounce)
// ---------------------------------------------------------------------------
test('D8 slide change with explicitNoVideo clears videos immediately after the identity debounce', async () => {
  const m = await loadHelpers()
  const T0 = 8_000_000
  const id = nextInstanceId()
  const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false }
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      announceTwice(
        m,
        setNow,
        T0,
        fg(id, { slideNumber: 3, videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videos: [V] }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // Slide 3 → 4 with explicit no-video: identity change → debounce, so
      // the first poll is silent...
      setNow(T0 + 601)
      m.handlePowerPointStatus(fg(id, { slideNumber: 4, videoDetected: false }))
      assert.equal(emitted.length, 0, 'identity change re-enters the 600ms debounce')

      // ...and the commit 600ms later already has videos undefined — a single
      // explicit poll suffices (slideChanged && explicitNoVideo), unlike the
      // same-slide two-poll rule (D7).
      setNow(T0 + 1_201)
      m.handlePowerPointStatus(fg(id, { slideNumber: 4, videoDetected: false }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata, cueMeta(id, { slideNumber: 4 }))
    }),
  )
})

// ---------------------------------------------------------------------------
// D9 — playing-detection enrichment: strict >200ms elapsed delta, forced
//      false on the rest when any delta fires, id → name → index matching
// ---------------------------------------------------------------------------
test('D9 enrichment: delta>200 marks playing (others forced false), exactly 200 does not, name beats index', async () => {
  const m = await loadHelpers()
  const T0 = 9_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      announceTwice(
        m,
        setNow,
        T0,
        fg(id, {
          videoDetected: true,
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_000,
          videos: [
            { id: 1, name: 'one', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: false },
            { id: 2, name: 'two', duration: 8_000, elapsed: 5_000, remaining: 3_000, playing: false },
          ],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // Matched by id: delta 250 (>200) → playing:true; delta 50 → forced
      // playing:false because at least one delta fired.
      setNow(T0 + 601)
      m.handlePowerPointStatus(
        fg(id, {
          videoDetected: true,
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_250,
          videos: [
            { id: 1, name: 'one', duration: 10_000, elapsed: 1_250, remaining: 8_750 },
            { id: 2, name: 'two', duration: 8_000, elapsed: 5_050, remaining: 2_950 },
          ],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata.videos, [
        { id: 1, name: 'one', duration: 10_000, elapsed: 1_250, remaining: 8_750, playing: true },
        { id: 2, name: 'two', duration: 8_000, elapsed: 5_050, remaining: 2_950, playing: false },
      ])
      emitted.length = 0

      // Delta of exactly 200 on both → NOT marked playing; with no delta
      // fired, entries pass through untouched (no playing key at all — the
      // prior playing flags are not carried forward).
      setNow(T0 + 602)
      m.handlePowerPointStatus(
        fg(id, {
          videoDetected: true,
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_450,
          videos: [
            { id: 1, name: 'one', duration: 10_000, elapsed: 1_450, remaining: 8_550 },
            { id: 2, name: 'two', duration: 8_000, elapsed: 5_250, remaining: 2_750 },
          ],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata.videos, [
        { id: 1, name: 'one', duration: 10_000, elapsed: 1_450, remaining: 8_550 },
        { id: 2, name: 'two', duration: 8_000, elapsed: 5_250, remaining: 2_750 },
      ])
      emitted.length = 0

      // Name match beats index: incoming entries have no ids and arrive in
      // reversed order. Name-matched deltas: 'two' 100 (→ forced false),
      // 'one' 300 (→ playing). Index matching would produce the opposite.
      setNow(T0 + 603)
      m.handlePowerPointStatus(
        fg(id, {
          videoDetected: true,
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_750,
          videos: [
            { name: 'two', duration: 8_000, elapsed: 5_350, remaining: 2_650 },
            { name: 'one', duration: 10_000, elapsed: 1_750, remaining: 8_250 },
          ],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata.videos, [
        { name: 'two', duration: 8_000, elapsed: 5_350, remaining: 2_650, playing: false },
        { name: 'one', duration: 10_000, elapsed: 1_750, remaining: 8_250, playing: true },
      ])
    }),
  )
})

// ---------------------------------------------------------------------------
// D10 — timing-field fallback to the prior announced snapshot (same
//       instance+slide): undefined fields keep the announced values
// ---------------------------------------------------------------------------
test('D10 timing fallback: undefined duration/playing/remaining keep announced values, elapsed updates', async () => {
  const m = await loadHelpers()
  const T0 = 10_000_000
  const id = nextInstanceId()
  const V = { id: 1, name: 'clip', duration: 10_000, elapsed: 1_000, remaining: 9_000, playing: true }
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      const emitted = attachEmitterCapture(m)

      announceTwice(
        m,
        setNow,
        T0,
        fg(id, {
          videoDetected: true,
          videoPlaying: true,
          videoDuration: 10_000,
          videoElapsed: 1_000,
          videoRemaining: 9_000,
          videos: [V],
        }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      emitted.length = 0

      // videoDetected:true but duration/playing/remaining undefined, elapsed
      // 1500 → committed metadata keeps videoDuration 10000 and videoPlaying
      // true from the announced snapshot, updates videoElapsed to 1500, and
      // keeps the now-STALE prior videoRemaining 9000 (fallback wins over the
      // duration-elapsed derivation). videos resolve from the warm cache.
      setNow(T0 + 601)
      m.handlePowerPointStatus(fg(id, { videoDetected: true, videoElapsed: 1_500 }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(id, { videoPlaying: true, videoDuration: 10_000, videoElapsed: 1_500, videoRemaining: 9_000, videos: [V] }),
      )
    }),
  )
})

// ---------------------------------------------------------------------------
// D11 — videoTimingUnavailable gating on videoDetected
// ---------------------------------------------------------------------------
test('D11 videoTimingUnavailable: true only with a video payload; false (not undefined) without one', async () => {
  const m = await loadHelpers()
  const T0 = 11_000_000
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      // With a video payload (videoDetected:true) and videoTimingUnavailable
      // true → committed metadata.videoTimingUnavailable === true.
      resetPresentation(m)
      seedRoom(m, 'room-a')
      let emitted = attachEmitterCapture(m)
      const idA = nextInstanceId()
      announceTwice(
        m,
        setNow,
        T0,
        fg(idA, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoTimingUnavailable: true }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.deepStrictEqual(
        cueEmits(emitted)[0].payload.cue.metadata,
        cueMeta(idA, {
          videoPlaying: false,
          videoDuration: 10_000,
          videoElapsed: 1_000,
          videoRemaining: 9_000,
          videoTimingUnavailable: true,
        }),
      )

      // No video payload at all → videoDetected false → committed
      // metadata.videoTimingUnavailable is exactly false (boolean, not
      // undefined: the snapshot gate `videoDetected && ... === true`
      // evaluates to false, and win32 passes it through).
      resetPresentation(m)
      seedRoom(m, 'room-a')
      emitted = attachEmitterCapture(m)
      const idB = nextInstanceId()
      announceTwice(m, setNow, T0 + 10_000, fg(idB))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.strictEqual(cueEmits(emitted)[0].payload.cue.metadata.videoTimingUnavailable, false)
      assert.deepStrictEqual(cueEmits(emitted)[0].payload.cue.metadata, cueMeta(idB))
    }),
  )
})

// ---------------------------------------------------------------------------
// D12 — videoTimingUnavailable gate: an explicitNoVideo poll that still claims
// videoTimingUnavailable:true must commit FALSE (the snapshot gate is
// `videoDetected && result.videoTimingUnavailable === true`, and videoDetected
// is false on the explicit path — videoTimingUnavailable is NOT part of the
// explicitNoVideo definition, so this input is reachable). Closes the M8
// mutation gap: dropping the `videoDetected &&` gate would commit true here.
// ---------------------------------------------------------------------------
test('D12 explicitNoVideo poll with videoTimingUnavailable:true commits videoTimingUnavailable false', async () => {
  const m = await loadHelpers()
  const T0 = 130_000_000
  const id = nextInstanceId()
  await withPlatform('win32', () =>
    withMutableNow(T0, (setNow) => {
      resetPresentation(m)
      seedRoom(m, 'room-a')
      let emitted = attachEmitterCapture(m)

      // Announce with a video payload carrying videoTimingUnavailable: true.
      announceTwice(
        m,
        setNow,
        T0,
        fg(id, { videoDetected: true, videoPlaying: false, videoDuration: 10_000, videoElapsed: 1_000, videoTimingUnavailable: true }),
      )
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_CREATED', 'PRESENTATION_LOADED'])
      assert.strictEqual(cueEmits(emitted)[0].payload.cue.metadata.videoTimingUnavailable, true)

      // explicitNoVideo poll (videoDetected false, no timing fields, no lists)
      // that still claims videoTimingUnavailable: true → timing fields drop →
      // immediate fast-path commit whose metadata.videoTimingUnavailable is
      // exactly false (gated off by videoDetected), NOT true.
      emitted = attachEmitterCapture(m)
      setNow(T0 + 601)
      m.handlePowerPointStatus(fg(id, { videoDetected: false, videoTimingUnavailable: true }))
      assert.deepStrictEqual(cueEventNames(emitted), ['LIVE_CUE_UPDATED', 'PRESENTATION_UPDATE'])
      assert.strictEqual(cueEmits(emitted)[0].payload.cue.metadata.videoTimingUnavailable, false)
    }),
  )
})
