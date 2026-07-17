// rebuild-target: packages/presentation-core
//
// Pure PowerPoint presentation-snapshot helpers carved out of `main.ts`
// (Stage 1b Lane B slice B-3). Staged app-internal because companion
// (CJS/Node16) cannot value-import `@ontime/*` workspace packages at
// runtime — their `exports` maps resolve to raw `.ts` files that Node
// cannot `require()`; package CJS builds are deferred by standing
// decision #29 (see the `resolveCompanionElapsedForState` header in
// `main.ts` for the precedent). This module graduates to
// `packages/presentation-core` when that blocker clears. Behavior is
// pinned by `main.presentation.test.ts` C1–C6, which exercise these
// functions through the `main.ts` re-export shim.

import type { LiveCue } from '@ontime/shared-types';

export type VideoTiming = {
  id?: number;
  name?: string;
  duration?: number;
  elapsed?: number;
  remaining?: number;
  playing?: boolean;
};

// LiveCue (+ its config/metadata) is adopted into `@ontime/shared-types`, and
// the LiveCueEventPayload/Presentation* wire envelopes into
// `@ontime/interface-contracts` (Stage 1b Lane B slice B-1). Kept as a local
// alias so `buildPowerPointCue`'s metadata literal stays typed without churn.
type LiveCueMetadata = NonNullable<LiveCue['metadata']>;

export type PowerPointPollState = 'foreground' | 'background' | 'none';

export type PowerPointPollResult = {
  state: PowerPointPollState;
  inSlideshow?: boolean;
  instanceId?: number;
  slideNumber?: number;
  totalSlides?: number;
  title?: string;
  filename?: string;
  editSlideVideos?: VideoTiming[];
  videoDetected?: boolean;
  videoPlaying?: boolean;
  videoDuration?: number;
  videoElapsed?: number;
  videoRemaining?: number;
  videos?: VideoTiming[];
  videoTimingUnavailable?: boolean;
};

export type PresentationSnapshot = {
  instanceId: number;
  slideNumber?: number;
  totalSlides?: number;
  title: string;
  filename?: string;
  videoPlaying?: boolean;
  videoDuration?: number;
  videoElapsed?: number;
  videoRemaining?: number;
  videos?: VideoTiming[];
  videoTimingUnavailable?: boolean;
};

export function snapshotsIdentityEqual(a: PresentationSnapshot | null, b: PresentationSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.instanceId === b.instanceId &&
    a.slideNumber === b.slideNumber &&
    a.totalSlides === b.totalSlides &&
    a.title === b.title &&
    a.filename === b.filename
  );
}

export function snapshotsTimingEqual(a: PresentationSnapshot | null, b: PresentationSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.videoPlaying === b.videoPlaying &&
    a.videoDuration === b.videoDuration &&
    a.videoElapsed === b.videoElapsed &&
    a.videoRemaining === b.videoRemaining &&
    a.videoTimingUnavailable === b.videoTimingUnavailable &&
    videoListsEqual(a.videos, b.videos)
  );
}

export function videoListsEqual(a?: VideoTiming[], b?: VideoTiming[]): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left?.id !== right?.id ||
      left?.name !== right?.name ||
      left?.duration !== right?.duration ||
      left?.elapsed !== right?.elapsed ||
      left?.remaining !== right?.remaining ||
      left?.playing !== right?.playing
    ) {
      return false;
    }
  }
  return true;
}

export function buildPowerPointCue(snapshot: PresentationSnapshot, startedAt: number): LiveCue {
  const derivedRemaining =
    snapshot.videoDuration !== undefined && snapshot.videoElapsed !== undefined
      ? snapshot.videoDuration - snapshot.videoElapsed
      : undefined;
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
  };

  if (process.platform === 'darwin') {
    metadata.videoTimingUnavailable = true;
  }

  return {
    id: `powerpoint:${snapshot.instanceId}`,
    source: 'powerpoint',
    title: snapshot.title,
    startedAt,
    status: 'playing',
    metadata,
  };
}
