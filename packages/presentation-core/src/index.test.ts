import { describe, expect, it } from 'vitest'
import { mergeCueVideos } from './index'
import type { CueVideo } from './index'

/**
 * Characterization for the live-cue `videos[]` merge rule that previously lived
 * as an inline closure in `frontend/src/context/UnifiedDataContext.tsx`.
 *
 * This is the long-deferred regression called out by:
 * - docs/edge-cases.md §7 (PowerPoint Video Timing)
 * - docs/rebuild-architecture.md §7 (deferred `mergeCueVideos` regression)
 * - frontend/src/utils/timer-utils.test.ts:81 (the TODO marker)
 *
 * The merge must preserve the historical behavior EXACTLY; any drift here is a
 * UI flicker regression on Windows PowerPoint slides.
 */

type Record = {
  cue: {
    id: string
    metadata?: {
      videos?: CueVideo[]
    }
  }
  updatedAt: number
}

const videos = (...vs: CueVideo[]): CueVideo[] => vs

describe('mergeCueVideos', () => {
  it('(a) incoming empty videos + existing has videos -> KEEPS existing videos', () => {
    // The empty-overwrite bug fix (edge-cases.md §7): a newer record with no
    // video metadata must not blank the videos the UI is already showing.
    const existing: Record = {
      cue: { id: 'c1', metadata: { videos: videos({ id: 7, name: 'clip.mp4', duration: 10 }) } },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: { id: 'c1', metadata: { videos: [] } },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result).toEqual({
      cue: { id: 'c1', metadata: { videos: videos({ id: 7, name: 'clip.mp4', duration: 10 }) } },
      updatedAt: 2,
    })
    // Spreads incoming first; video array identity comes from existing.
    expect(result.cue.metadata?.videos).toBe(existing.cue.metadata?.videos)
  })

  it('(b) both empty -> returns incoming unchanged', () => {
    const existing: Record = {
      cue: { id: 'c1', metadata: { videos: [] } },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: { id: 'c1', metadata: { videos: [] } },
      updatedAt: 2,
    }
    expect(mergeCueVideos(existing, incoming)).toBe(incoming)
  })

  it('(b.2) both empty (metadata.videos undefined) -> returns incoming unchanged', () => {
    const existing: Record = { cue: { id: 'c1' }, updatedAt: 1 }
    const incoming: Record = { cue: { id: 'c1' }, updatedAt: 2 }
    expect(mergeCueVideos(existing, incoming)).toBe(incoming)
  })

  it('(c) existing empty + incoming has videos -> returns incoming', () => {
    const existing: Record = { cue: { id: 'c1', metadata: { videos: [] } }, updatedAt: 1 }
    const incoming: Record = {
      cue: { id: 'c1', metadata: { videos: videos({ id: 1, name: 'a.mp4' }) } },
      updatedAt: 2,
    }
    expect(mergeCueVideos(existing, incoming)).toBe(incoming)
  })

  it('(d) id-match -> per-field fallback merge (incoming wins, existing backfills missing fields)', () => {
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: {
          videos: videos({
            id: 7,
            name: 'clip.mp4',
            duration: 100,
            elapsed: 20,
            remaining: 80,
            playing: true,
            status: 'playing',
          }),
        },
      },
      updatedAt: 1,
    }
    // Incoming only carries a subset; missing fields must fall back to existing.
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: {
          videos: videos({ id: 7, elapsed: 25, status: 'playing' }),
        },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([
      {
        id: 7,
        name: 'clip.mp4',
        duration: 100,
        elapsed: 25,
        remaining: 80,
        playing: true,
        status: 'playing',
      },
    ])
    // Non-video fields on `incoming` pass through unchanged; existing is not
    // spread into the result for non-video fields.
    expect(result.updatedAt).toBe(2)
  })

  it('(d.2) id-match when incoming carries a value -> incoming wins over existing', () => {
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 7, name: 'old.mp4', duration: 50 }) },
      },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 7, name: 'new.mp4', duration: 60 }) },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([
      { id: 7, name: 'new.mp4', duration: 60 },
    ])
  })

  it('(e) name-match when no id -> matches by name, per-field fallback', () => {
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: {
          videos: videos({ name: 'shared.mp4', duration: 30, remaining: 12 }),
        },
      },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: {
          videos: videos({ name: 'shared.mp4', elapsed: 18, status: 'playing' }),
        },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([
      { name: 'shared.mp4', duration: 30, remaining: 12, elapsed: 18, status: 'playing' },
    ])
  })

  it('(e.2) existing entry has an id but incoming does NOT -> falls back to name match', () => {
    // Confirms id-match is gated on BOTH sides having the same id; an existing
    // entry with id=7 and an incoming entry with no id cannot id-match, so the
    // name path is the only path.
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 7, name: 'shared.mp4', duration: 30 }) },
      },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ name: 'shared.mp4', elapsed: 5 }) },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([
      { id: 7, name: 'shared.mp4', duration: 30, elapsed: 5 },
    ])
  })

  it('(f) no match (distinct id and name) -> incoming video returned unchanged', () => {
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 1, name: 'one.mp4', duration: 10 }) },
      },
      updatedAt: 1,
    }
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 2, name: 'two.mp4', duration: 20 }) },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([{ id: 2, name: 'two.mp4', duration: 20 }])
    // Identity preserved (the unmatched incoming video is returned as-is).
    expect(result.cue.metadata?.videos?.[0]).toBe(incoming.cue.metadata?.videos?.[0])
  })

  it('preserves arbitrary extra record fields (generic passthrough)', () => {
    type Rich = {
      cue: {
        id: string
        source: 'powerpoint' | 'external_video' | 'pdf'
        metadata?: { videos?: CueVideo[] }
      }
      updatedAt: number
      source: 'companion' | 'controller'
      notes?: string
    }
    const existing: Rich = {
      cue: { id: 'c1', source: 'powerpoint', metadata: { videos: [] } },
      updatedAt: 1,
      source: 'companion',
      notes: 'stale',
    }
    const incoming: Rich = {
      cue: { id: 'c1', source: 'powerpoint', metadata: { videos: [] } },
      updatedAt: 5,
      source: 'controller',
      notes: 'fresh',
    }
    const result = mergeCueVideos(existing, incoming)
    // existing is NOT spread into the result; only the videos array is grafted.
    expect(result).toMatchObject({
      updatedAt: 5,
      source: 'controller',
      notes: 'fresh',
      cue: { id: 'c1', source: 'powerpoint' },
    })
  })

  it('id-match preferred over name-match when both exist on different entries', () => {
    const existing: Record = {
      cue: {
        id: 'c1',
        metadata: {
          videos: videos(
            { id: 1, name: 'shared.mp4', duration: 100 },
            { id: 2, name: 'shared.mp4', duration: 200 },
          ),
        },
      },
      updatedAt: 1,
    }
    // Incoming matches entry[1] by id=2; entry[0] also shares the name, but
    // id must win.
    const incoming: Record = {
      cue: {
        id: 'c1',
        metadata: { videos: videos({ id: 2, name: 'shared.mp4', elapsed: 5 }) },
      },
      updatedAt: 2,
    }
    const result = mergeCueVideos(existing, incoming)
    expect(result.cue.metadata?.videos).toEqual([
      { id: 2, name: 'shared.mp4', duration: 200, elapsed: 5 },
    ])
  })
})
