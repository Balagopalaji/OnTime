import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizePowerPointPoll,
  projectPowerPointView,
  type PowerPointPollResult,
  type PowerPointVideoTile,
  type PowerPointViewState,
} from '@ontime/presentation-core'
import { parseRemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import { toSnapshotCandidate } from './candidate-adapter'

const OBSERVED = 1_790_000_000_000
const modes = { timingMode: 'remaining' as const, headlineMode: 'longest-remaining' as const }

const tile = (p: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile => ({
  status: 'ready', playing: false, durationMs: null, elapsedMs: null, remainingMs: null, isFocus: false, ...p,
})
const base = { multipleVideos: false, videoCount: 0, multipleInstanceWarning: false }
const deck = {
  slideNumber: 3, totalSlides: 12, title: 'Sunday Service', filenameBasename: 'Sunday Service.pptx',
  selectedVideoId: 88213, selectedVideoName: 'C:\\Media\\walk-in.mp4', timeMs: 1, durationMs: 1, ...base,
}

describe('toSnapshotCandidate — host view to the privacy allowlist', () => {
  it.each([
    ['connecting', { availability: 'connecting', payload: null }],
    ['unavailable', { availability: 'source-unavailable', payload: { reason: 'helper-unavailable' } }],
    ['powerpoint_not_running', { availability: 'source-unavailable', payload: { reason: 'no-presentation' } }],
    ['no_slideshow', { availability: 'source-unavailable', payload: { reason: 'no-slideshow' } }],
  ] as const)('maps %s exactly (Deep Plan host-state table)', (kind, expected) => {
    const result = toSnapshotCandidate({ kind, ...base } as PowerPointViewState, OBSERVED, modes)
    expect(result).toEqual({
      ok: true,
      value: { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs: OBSERVED, ...expected },
    })
  })

  it('reconstructs a playing slide with sanitized labels and no host-internal fields', () => {
    // Defect: paths, media IDs, filenames, or warnings cross the process boundary.
    const state = {
      kind: 'playing', ...deck, multipleInstanceWarning: true, videoCount: 2, multipleVideos: true,
      videos: [
        tile({ ordinal: 0, id: 88213, name: 'C:\\Media\\Walk-in loop.mp4', status: 'playing', playing: true, durationMs: 120_000, elapsedMs: 30_000, remainingMs: 90_000, isFocus: true }),
        tile({ ordinal: 1, id: 90001, name: '\u202eBumper.mov', durationMs: 45_000 }),
      ],
    } as PowerPointViewState
    const result = toSnapshotCandidate(state, OBSERVED, { timingMode: 'elapsed', headlineMode: 'latest-started' })
    expect(result).toEqual({
      ok: true,
      value: {
        schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs: OBSERVED, availability: 'active',
        payload: {
          reason: 'presentation', presentationState: 'playing', slideNumber: 3, slideCount: 12, displayTitle: 'Sunday Service',
          headline: { focusedOrdinal: 0, mode: 'latest-started', timingMode: 'elapsed' },
          videos: [
            { ordinal: 0, label: 'Walk-in loop', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true },
            { ordinal: 1, label: 'Bumper', status: 'ready', durationMs: 45_000, elapsedMsAtObservation: null, remainingMsAtObservation: null, isFocus: false },
          ],
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/88213|90001|Media|pptx|instance/i)
  })

  it('derives remaining from duration and elapsed when the host did not observe it, and floors overrun at zero', () => {
    const state = {
      kind: 'playing', ...deck, videoCount: 2, multipleVideos: true,
      videos: [
        tile({ ordinal: 0, status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 15_000, remainingMs: null, isFocus: true }),
        tile({ ordinal: 1, status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 61_000, remainingMs: -1_000 }),
      ],
    } as PowerPointViewState
    const result = toSnapshotCandidate(state, OBSERVED, modes)
    if (!result.ok || result.value.availability !== 'active') throw new Error(JSON.stringify(result))
    expect(result.value.payload.videos.map((v) => v.remainingMsAtObservation)).toEqual([45_000, 0])
  })

  it('publishes timing-unavailable with no numeric timing (never stale numbers)', () => {
    const state = {
      kind: 'timing_unavailable', ...deck, videoCount: 1,
      videos: [tile({ ordinal: 0, name: 'Clip', status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 5_000, remainingMs: 55_000 })],
    } as PowerPointViewState
    const result = toSnapshotCandidate(state, OBSERVED, modes)
    if (!result.ok || result.value.availability !== 'active') throw new Error(JSON.stringify(result))
    expect(result.value.payload.presentationState).toBe('timing-unavailable')
    expect(result.value.payload.videos).toEqual([
      { ordinal: 0, label: 'Clip', status: 'playing', durationMs: null, elapsedMsAtObservation: null, remainingMsAtObservation: null, isFocus: false },
    ])
  })

  it('degrades a playing slide whose playing row lacks timing to timing-unavailable instead of failing', () => {
    // Defect: an unmeasured playing row makes the whole publish invalid, so viewers freeze.
    const state = {
      kind: 'playing', ...deck, videoCount: 2, multipleVideos: true,
      videos: [
        tile({ ordinal: 0, status: 'playing', playing: true, durationMs: 60_000, elapsedMs: 1_000, remainingMs: 59_000, isFocus: true }),
        tile({ ordinal: 1, status: 'playing', playing: true, durationMs: null, elapsedMs: 2_000, remainingMs: null }),
      ],
    } as PowerPointViewState
    const result = toSnapshotCandidate(state, OBSERVED, modes)
    if (!result.ok || result.value.availability !== 'active') throw new Error(JSON.stringify(result))
    expect(result.value.payload.presentationState).toBe('timing-unavailable')
    expect(result.value.payload.videos.every((v) => v.durationMs === null && v.elapsedMsAtObservation === null)).toBe(true)
  })

  it('drops an impossible slide count rather than publishing an invalid position', () => {
    const state = { kind: 'no_video', ...deck, slideNumber: 14, totalSlides: 12, videos: [] } as PowerPointViewState
    const result = toSnapshotCandidate(state, OBSERVED, modes)
    if (!result.ok || result.value.availability !== 'active') throw new Error(JSON.stringify(result))
    expect([result.value.payload.slideNumber, result.value.payload.slideCount]).toEqual([14, null])
  })

  it('every recorded H1 observation projects to a candidate the strict parser accepts (RPV-006)', () => {
    // Defect: a real host state is rejected by the contract, so publishing fails in the show.
    const fixtures = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../../../packages/presentation-core/test/fixtures/powerpoint-observations.json'), 'utf8'),
    ).observations as Record<string, PowerPointPollResult>
    // Running-slideshow observations (the others are covered by the host-state table above).
    const keys = Object.keys(fixtures).filter((key) => 'slideNumber' in fixtures[key])
    expect(keys.sort()).toEqual(['ended', 'multipleVideo', 'paused', 'playing'])
    for (const key of keys) {
      const { snapshot } = normalizePowerPointPoll({
        result: fixtures[key] as PowerPointPollResult & { instanceId: number },
        announced: null, videoCache: new Map(), primaryCache: new Map(),
        noVideoKey: null, noVideoCount: 0, explicitNoVideoKey: null, explicitNoVideoCount: 0,
      })
      for (const timingMode of ['remaining', 'elapsed'] as const) {
        for (const headlineMode of ['longest-remaining', 'latest-started'] as const) {
          const view = projectPowerPointView({ kind: 'presentation', snapshot }, { timingMode, headlineMode })
          const result = toSnapshotCandidate(view, OBSERVED, { timingMode, headlineMode })
          expect(result.ok, `${key}/${timingMode}/${headlineMode}: ${JSON.stringify(result)}`).toBe(true)
          if (result.ok) expect(parseRemoteSnapshotCandidateV1(result.value)).toEqual({ ok: true, value: result.value })
        }
      }
    }
  })
})
