import type { PresentationVideo } from './powerpoint-types'
import { resolveVideoStatus } from './powerpoint-status'

export type PowerPointHeadlineMode = 'longest-remaining' | 'latest-started'

export type PlayingHeadlineSelection =
  | { kind: 'selected'; index: number }
  | { kind: 'timing-unavailable' }
  | { kind: 'fallback' }

function usableRemaining(video: PresentationVideo): number | null {
  const value = video.remaining ??
    (video.duration !== undefined && video.elapsed !== undefined ? video.duration - video.elapsed : undefined)
  return value !== undefined && Number.isFinite(value) ? value : null
}

/**
 * Select the standalone headline only while at least one video is playing.
 * `fallback` deliberately delegates the no-playing case to the helper-primary
 * selector so the established next-to-play behavior remains unchanged.
 */
export function selectPlayingHeadline(
  videos: readonly PresentationVideo[],
  mode: PowerPointHeadlineMode,
  playOrder?: ReadonlyMap<number, number>,
): PlayingHeadlineSelection {
  const playing = videos
    .map((video, index) => ({ video, index, rank: video.id === undefined ? -1 : (playOrder?.get(video.id) ?? -1) }))
    .filter(({ video }) => resolveVideoStatus(video) === 'playing')
  if (playing.length === 0) return { kind: 'fallback' }

  if (mode === 'longest-remaining') {
    const timed = playing.map((entry) => ({ ...entry, remaining: usableRemaining(entry.video) }))
    if (timed.some(({ remaining }) => remaining === null)) return { kind: 'timing-unavailable' }
    timed.sort((a, b) => b.remaining! - a.remaining! || b.rank - a.rank || a.index - b.index)
    return { kind: 'selected', index: timed[0]!.index }
  }

  playing.sort((a, b) => b.rank - a.rank || a.index - b.index)
  return { kind: 'selected', index: playing[0]!.index }
}
