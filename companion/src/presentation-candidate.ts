// rebuild-target: packages/presentation-core

// PowerPoint presentation candidate/commit state machine + poll-status
// decision core + detection poll loop, carved out of companion/src/main.ts
// (Stage 1b Lane B slice B-5b). Staged app-internal for the same reason as
// ./presentation-snapshot.ts (B-3): companion (CJS/Node16) cannot
// value-import @ontime/* packages at runtime (package CJS builds deferred by
// decision #29); graduates to packages/presentation-core when that lands.
//
// Behavior is pinned by main.presentation.test.ts C7-C16 and
// main.ppt-status.test.ts D1-D12, which exercise these functions through the
// main.ts re-export shim. Bodies are verbatim; the ONLY non-verbatim lines
// are the dependency seam (configurePresentationCandidate below) and one
// interpolation swap (currentCompanionMode -> getCompanionMode()) in
// startPowerPointDetection's appendPptLog line. main.ts injects the live-cue
// emitters, getPresentationRoomIds, getCompanionCapabilities, and the mode
// getter at module init (the controlAuditDeps wiring pattern).

import type { LiveCue } from '@ontime/shared-types';
import {
  buildPowerPointCue,
  snapshotsIdentityEqual,
  snapshotsTimingEqual,
} from './presentation-snapshot';
import type { PowerPointPollResult, PresentationSnapshot, VideoTiming } from './presentation-snapshot';
import { fetchPowerPointStatus } from './ppt-probe';
import { appendPptLog, isPptDebugEnabled, logPptInfo, logPptVerbose } from './ppt-debug-log';

type PresentationCandidateDeps = {
  emitLiveCueCreated: (roomId: string, cue: LiveCue) => void;
  emitLiveCueUpdated: (roomId: string, cue: LiveCue) => void;
  emitLiveCueEnded: (roomId: string, cue: LiveCue) => void;
  emitPresentationLoaded: (roomId: string, cue: LiveCue) => void;
  emitPresentationUpdate: (roomId: string, cue: LiveCue) => void;
  emitPresentationClear: (roomId: string, cueId?: string) => void;
  getPresentationRoomIds: () => string[];
  getCompanionCapabilities: () => { powerpoint: boolean; externalVideo: boolean; fileOperations: boolean };
  getCompanionMode: () => string;
};

// Injected as same-named module bindings so every moved function body below
// stays character-identical to its main.ts original.
let emitLiveCueCreated: PresentationCandidateDeps['emitLiveCueCreated'];
let emitLiveCueUpdated: PresentationCandidateDeps['emitLiveCueUpdated'];
let emitLiveCueEnded: PresentationCandidateDeps['emitLiveCueEnded'];
let emitPresentationLoaded: PresentationCandidateDeps['emitPresentationLoaded'];
let emitPresentationUpdate: PresentationCandidateDeps['emitPresentationUpdate'];
let emitPresentationClear: PresentationCandidateDeps['emitPresentationClear'];
let getPresentationRoomIds: PresentationCandidateDeps['getPresentationRoomIds'];
let getCompanionCapabilities: PresentationCandidateDeps['getCompanionCapabilities'];
let getCompanionMode: PresentationCandidateDeps['getCompanionMode'];

export function configurePresentationCandidate(deps: PresentationCandidateDeps): void {
  ({
    emitLiveCueCreated,
    emitLiveCueUpdated,
    emitLiveCueEnded,
    emitPresentationLoaded,
    emitPresentationUpdate,
    emitPresentationClear,
    getPresentationRoomIds,
    getCompanionCapabilities,
    getCompanionMode,
  } = deps);
}

const PPT_POLL_INTERVAL_MS = 1000;
const PPT_DEBOUNCE_MS = 600;
const PPT_VIDEO_CLEAR_POLLS = 2;
const PPT_BACKGROUND_CLEAR_MS = 10_000;
let pptNoVideoKey: string | null = null;
let pptNoVideoCount = 0;
let pptExplicitNoVideoKey: string | null = null;
let pptExplicitNoVideoCount = 0;
const pptVideoCache = new Map<string, VideoTiming[]>();
let pptPollTimer: NodeJS.Timeout | null = null;
let pptPollInFlight = false;
let pptAnnouncedSnapshot: PresentationSnapshot | null = null;
let pptCandidateSnapshot: PresentationSnapshot | null = null;
let pptCandidateSince = 0;
let pptBackgroundSince: number | null = null;
let pptActiveCue: LiveCue | null = null;

export function commitPresentationSnapshot(snapshot: PresentationSnapshot | null) {
  const roomIds = getPresentationRoomIds();
  if (!snapshot) {
    if (!pptAnnouncedSnapshot) return;
    const cueId = `powerpoint:${pptAnnouncedSnapshot.instanceId}`;
    if (pptActiveCue) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' };
      roomIds.forEach((roomId) => {
        emitLiveCueEnded(roomId, endedCue);
        emitPresentationClear(roomId, cueId);
      });
    } else {
      roomIds.forEach((roomId) => emitPresentationClear(roomId, cueId));
    }
    pptAnnouncedSnapshot = null;
    pptActiveCue = null;
    return;
  }

  const cueId = `powerpoint:${snapshot.instanceId}`;
  const startedAt = pptActiveCue?.id === cueId ? pptActiveCue.startedAt ?? Date.now() : Date.now();
  const cue = buildPowerPointCue(snapshot, startedAt);

  if (!pptActiveCue || pptActiveCue.id !== cueId) {
    if (pptActiveCue && pptActiveCue.id !== cueId) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' };
      roomIds.forEach((roomId) => emitLiveCueEnded(roomId, endedCue));
    }
    roomIds.forEach((roomId) => {
      emitLiveCueCreated(roomId, cue);
      emitPresentationLoaded(roomId, cue);
    });
  } else {
    roomIds.forEach((roomId) => {
      emitLiveCueUpdated(roomId, cue);
      emitPresentationUpdate(roomId, cue);
    });
  }

  pptActiveCue = cue;
  pptAnnouncedSnapshot = snapshot;
}

export function updatePresentationCandidate(snapshot: PresentationSnapshot | null) {
  const now = Date.now();
  if (pptAnnouncedSnapshot && snapshotsIdentityEqual(snapshot, pptAnnouncedSnapshot)) {
    if (!snapshotsTimingEqual(snapshot, pptAnnouncedSnapshot)) {
      commitPresentationSnapshot(snapshot);
    }
    return;
  }

  if (!snapshotsIdentityEqual(snapshot, pptCandidateSnapshot)) {
    pptCandidateSnapshot = snapshot;
    pptCandidateSince = now;
  } else if (!snapshotsTimingEqual(snapshot, pptCandidateSnapshot)) {
    // Same identity but timing/videos changed - update content without resetting debounce
    pptCandidateSnapshot = snapshot;
  }

  if (now - pptCandidateSince < PPT_DEBOUNCE_MS) {
    return;
  }

  if (snapshotsIdentityEqual(snapshot, pptAnnouncedSnapshot)) {
    return;
  }

  commitPresentationSnapshot(snapshot);
}

export function handlePowerPointStatus(result: PowerPointPollResult | null) {
  if (!result) {
    logPptVerbose('[ppt] status: null');
    return;
  }

  logPptVerbose('[ppt] status', result);

  const now = Date.now();
  if (result.state === 'foreground' || result.state === 'background') {
    if (result.state === 'foreground') {
      pptBackgroundSince = null;
    } else {
      if (pptBackgroundSince === null) {
        pptBackgroundSince = now;
      }
    }
    if (!result.instanceId) {
      return;
    }
    if (result.inSlideshow === false) {
      if (pptAnnouncedSnapshot) {
        updatePresentationCandidate(null);
      }
      return;
    }
    const title = result.title?.trim() || result.filename?.trim() || 'PowerPoint';
    const lastSlideNumber =
      pptAnnouncedSnapshot?.instanceId === result.instanceId ? pptAnnouncedSnapshot.slideNumber : undefined;
    const resolvedSlideNumber = result.slideNumber ?? lastSlideNumber;
    const slideKey = `${result.instanceId}:${resolvedSlideNumber ?? 'unknown'}`;
    const slideChanged =
      pptAnnouncedSnapshot?.instanceId === result.instanceId &&
      pptAnnouncedSnapshot.slideNumber !== resolvedSlideNumber;
    const explicitNoVideo =
      result.videoDetected === false &&
      result.videoDuration === undefined &&
      result.videoElapsed === undefined &&
      result.videoRemaining === undefined &&
      (!result.videos || result.videos.length === 0) &&
      (!result.editSlideVideos || result.editSlideVideos.length === 0);
    let videos = result.videos && result.videos.length > 0 ? result.videos : undefined;
    if (!videos && result.editSlideVideos && result.editSlideVideos.length > 0) {
      videos = result.editSlideVideos;
    }
    if (!videos && !explicitNoVideo) {
      const cached = pptVideoCache.get(slideKey);
      if (cached) {
        videos = cached;
      }
    }
    logPptVerbose('[ppt] cache probe', {
      slideKey,
      slideNumber: resolvedSlideNumber,
      slideChanged,
      explicitNoVideo,
      hasVideos: videos?.length ?? 0,
      cachedVideos: pptVideoCache.get(slideKey)?.length ?? 0,
      resultVideos: result.videos?.length ?? 0,
      editVideos: result.editSlideVideos?.length ?? 0,
      videoDetected: result.videoDetected,
      videoDuration: result.videoDuration,
      videoElapsed: result.videoElapsed,
      videoRemaining: result.videoRemaining,
    });
    const hasVideoPayload =
      !explicitNoVideo &&
      (result.videoDetected === true ||
        (videos && videos.length > 0) ||
        result.videoDuration !== undefined ||
        result.videoElapsed !== undefined ||
        result.videoRemaining !== undefined ||
        result.videoPlaying !== undefined ||
        result.videoTimingUnavailable === true);
    if (!hasVideoPayload) {
      if (pptNoVideoKey === slideKey) {
        pptNoVideoCount += 1;
      } else {
        pptNoVideoKey = slideKey;
        pptNoVideoCount = 1;
      }
    } else {
      pptNoVideoKey = null;
      pptNoVideoCount = 0;
    }
    if (explicitNoVideo) {
      if (pptExplicitNoVideoKey === slideKey) {
        pptExplicitNoVideoCount += 1;
      } else {
        pptExplicitNoVideoKey = slideKey;
        pptExplicitNoVideoCount = 1;
      }
    } else {
      pptExplicitNoVideoKey = null;
      pptExplicitNoVideoCount = 0;
    }
    if (slideChanged) {
      pptNoVideoKey = slideKey;
      pptNoVideoCount = explicitNoVideo ? PPT_VIDEO_CLEAR_POLLS : 0;
      pptExplicitNoVideoKey = slideKey;
      pptExplicitNoVideoCount = explicitNoVideo ? PPT_VIDEO_CLEAR_POLLS : 0;
    }
    const shouldClearVideo =
      (slideChanged && explicitNoVideo) ||
      (!hasVideoPayload && pptNoVideoCount >= PPT_VIDEO_CLEAR_POLLS);
    const shouldClearExplicit =
      explicitNoVideo && pptExplicitNoVideoCount >= PPT_VIDEO_CLEAR_POLLS;
    if (shouldClearVideo || shouldClearExplicit) {
      pptVideoCache.delete(slideKey);
      videos = undefined;
      logPptVerbose('[ppt] cache cleared', {
        slideKey,
        shouldClearVideo,
        shouldClearExplicit,
        pptNoVideoCount,
        pptExplicitNoVideoCount,
      });
    }
    const priorSnapshot =
      pptAnnouncedSnapshot?.instanceId === result.instanceId &&
      pptAnnouncedSnapshot.slideNumber === resolvedSlideNumber
        ? pptAnnouncedSnapshot
        : null;
    const videoDetected = hasVideoPayload && !shouldClearVideo;
    const canReuseVideo = videoDetected && priorSnapshot !== null;
    if (videos && videoDetected) {
      if (priorSnapshot?.videos && priorSnapshot.videos.length > 0) {
        let hasDelta = false;
        videos = videos.map((video, index) => {
          const prior =
            priorSnapshot.videos?.find((entry) => entry.id !== undefined && entry.id === video.id) ??
            priorSnapshot.videos?.find((entry) => entry.name && entry.name === video.name) ??
            priorSnapshot.videos?.[index];
          const currentElapsed = video.elapsed ?? null;
          const priorElapsed = prior?.elapsed ?? null;
          const delta =
            currentElapsed !== null && priorElapsed !== null ? currentElapsed - priorElapsed : null;
          if (delta !== null && delta > 200) {
            hasDelta = true;
            return { ...video, playing: true };
          }
          return video;
        });
        if (hasDelta) {
          videos = videos.map((video) =>
            video.playing ? video : { ...video, playing: false }
          );
        }
      }
      pptVideoCache.set(slideKey, videos);
    }
    // Calculate resolvedVideos AFTER enrichment so we get the enriched array
    const resolvedVideos =
      shouldClearVideo || shouldClearExplicit
        ? undefined
        : videos ?? priorSnapshot?.videos;
    const lastVideoDuration = priorSnapshot?.videoDuration;
    const lastVideoElapsed = priorSnapshot?.videoElapsed;
    const lastVideoRemaining = priorSnapshot?.videoRemaining;
    const lastVideoPlaying = priorSnapshot?.videoPlaying;
    const snapshot: PresentationSnapshot = {
      instanceId: result.instanceId,
      slideNumber: resolvedSlideNumber,
      totalSlides: result.totalSlides,
      title,
      filename: result.filename,
      videoPlaying: videoDetected ? result.videoPlaying ?? lastVideoPlaying : undefined,
      videoDuration: videoDetected ? result.videoDuration ?? lastVideoDuration : undefined,
      videoElapsed: videoDetected ? result.videoElapsed ?? lastVideoElapsed : undefined,
      videoRemaining: videoDetected ? result.videoRemaining ?? lastVideoRemaining : undefined,
      videos: resolvedVideos,
      videoTimingUnavailable: videoDetected && result.videoTimingUnavailable === true,
    };
    updatePresentationCandidate(snapshot);
    return;
  }

  pptBackgroundSince = null;
  updatePresentationCandidate(null);
}

export function startPowerPointDetection() {
  if (pptPollTimer) return;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    if (isPptDebugEnabled()) {
      logPptInfo('[ppt] detection disabled: unsupported platform')
    }
    return;
  }
  if (!getCompanionCapabilities().powerpoint) {
    if (isPptDebugEnabled()) {
      logPptInfo('[ppt] detection disabled: capability false')
    }
    return;
  }

  if (isPptDebugEnabled()) {
    logPptInfo('[ppt] detection started', { platform: process.platform })
  }
  void appendPptLog(`[ppt] detection start mode=${getCompanionMode()} caps=${JSON.stringify(getCompanionCapabilities())}`);

  pptPollTimer = setInterval(() => {
    if (pptPollInFlight) return;
    pptPollInFlight = true;
    fetchPowerPointStatus()
      .then((result) => handlePowerPointStatus(result))
      .finally(() => {
        pptPollInFlight = false;
      });
  }, PPT_POLL_INTERVAL_MS);
}

// Detection-timer access for main.ts's mode-change wiring (the timer state
// moved here with the poll loop; ordering of the stop sequence is preserved
// at the call site).
export function isPowerPointDetectionActive(): boolean {
  return pptPollTimer !== null;
}

export function stopPowerPointDetectionTimer(): void {
  if (!pptPollTimer) return;
  clearInterval(pptPollTimer);
  pptPollTimer = null;
}
