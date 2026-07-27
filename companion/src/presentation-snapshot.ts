// rebuild-target: packages/presentation-core
//
// Compatibility boundary for Companion's existing presentation snapshot API.
// Pure types and comparators are provided by presentation-core; cue building
// remains local so the Companion's LiveCue/platform behavior stays identical.

import type { LiveCue } from '@ontime/shared-types'
import {
  snapshotsIdentityEqual,
  snapshotsTimingEqual,
  videoListsEqual,
} from '@ontime/presentation-core'
import type {
  PowerPointPollResult,
  PowerPointPollState,
  PresentationSnapshot,
  PresentationVideo,
} from '@ontime/presentation-core'

export {
  snapshotsIdentityEqual,
  snapshotsTimingEqual,
  videoListsEqual,
} from '@ontime/presentation-core'
export type {
  PowerPointPollResult,
  PowerPointPollState,
  PresentationSnapshot,
  PresentationVideo,
}
export type { PresentationVideo as VideoTiming }

type LiveCueMetadata = NonNullable<LiveCue['metadata']>

export function buildPowerPointCue(snapshot: PresentationSnapshot, startedAt: number): LiveCue {
  const derivedRemaining =
    snapshot.videoDuration !== undefined && snapshot.videoElapsed !== undefined
      ? snapshot.videoDuration - snapshot.videoElapsed
      : undefined
  const metadata: LiveCueMetadata = {
    slideNumber: snapshot.slideNumber,
    totalSlides: snapshot.totalSlides,
    filename: snapshot.filename,
    player: 'powerpoint',
    instanceId: snapshot.instanceId,
    videoPlaying: snapshot.videoPlaying,
    videoDuration: snapshot.videoDuration,
    videoElapsed: snapshot.videoElapsed,
    videoRemaining: snapshot.videoRemaining ?? derivedRemaining,
    videos: snapshot.videos,
    videoTimingUnavailable: snapshot.videoTimingUnavailable,
  }

  if (process.platform === 'darwin') {
    metadata.videoTimingUnavailable = true
  }

  return {
    id: `powerpoint:${snapshot.instanceId}`,
    source: 'powerpoint',
    title: snapshot.title,
    startedAt,
    status: 'playing',
    metadata,
  }
}
