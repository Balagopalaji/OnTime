// rebuild-target: packages/presentation-core

import type { LiveCue } from '@ontime/shared-types'
import { PowerPointSession, type BridgePollOutcome, type PowerPointObservation } from '@ontime/ppt-bridge'
import {
  buildPowerPointCue,
} from './presentation-snapshot'
import type { PowerPointPollResult, PresentationSnapshot } from './presentation-snapshot'
import { fetchPowerPointStatus } from './ppt-probe'
import { appendPptLog, isPptDebugEnabled, logPptInfo, logPptVerbose } from './ppt-debug-log'

type PresentationCandidateDeps = {
  emitLiveCueCreated: (roomId: string, cue: LiveCue) => void
  emitLiveCueUpdated: (roomId: string, cue: LiveCue) => void
  emitLiveCueEnded: (roomId: string, cue: LiveCue) => void
  emitPresentationLoaded: (roomId: string, cue: LiveCue) => void
  emitPresentationUpdate: (roomId: string, cue: LiveCue) => void
  emitPresentationClear: (roomId: string, cueId?: string) => void
  getPresentationRoomIds: () => string[]
  getCompanionCapabilities: () => { powerpoint: boolean; externalVideo: boolean; fileOperations: boolean }
  getCompanionMode: () => string
}

let emitLiveCueCreated: PresentationCandidateDeps['emitLiveCueCreated']
let emitLiveCueUpdated: PresentationCandidateDeps['emitLiveCueUpdated']
let emitLiveCueEnded: PresentationCandidateDeps['emitLiveCueEnded']
let emitPresentationLoaded: PresentationCandidateDeps['emitPresentationLoaded']
let emitPresentationUpdate: PresentationCandidateDeps['emitPresentationUpdate']
let emitPresentationClear: PresentationCandidateDeps['emitPresentationClear']
let getPresentationRoomIds: PresentationCandidateDeps['getPresentationRoomIds']
let getCompanionCapabilities: PresentationCandidateDeps['getCompanionCapabilities']
let getCompanionMode: PresentationCandidateDeps['getCompanionMode']

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
  } = deps)
}

let pptAnnouncedSnapshot: PresentationSnapshot | null = null
let pptActiveCue: LiveCue | null = null

export function projectObservation(observation: PowerPointObservation, inSlideshow?: boolean): PowerPointPollResult {
  return {
    state: observation.state,
    ...(observation.inSlideshow !== undefined || inSlideshow !== undefined ? { inSlideshow: inSlideshow ?? observation.inSlideshow } : {}),
    ...(observation.instanceId !== undefined ? { instanceId: observation.instanceId } : {}),
    ...(observation.slideNumber !== undefined ? { slideNumber: observation.slideNumber } : {}),
    ...(observation.totalSlides !== undefined ? { totalSlides: observation.totalSlides } : {}),
    ...(observation.title !== undefined ? { title: observation.title } : {}),
    ...(observation.filename !== undefined ? { filename: observation.filename } : {}),
    ...(observation.editSlideVideos !== undefined ? { editSlideVideos: observation.editSlideVideos } : {}),
    ...(observation.videoDetected !== undefined ? { videoDetected: observation.videoDetected } : {}),
    ...(observation.videoPlaying !== undefined ? { videoPlaying: observation.videoPlaying } : {}),
    ...(observation.videoDuration !== undefined ? { videoDuration: observation.videoDuration } : {}),
    ...(observation.videoElapsed !== undefined ? { videoElapsed: observation.videoElapsed } : {}),
    ...(observation.videoRemaining !== undefined ? { videoRemaining: observation.videoRemaining } : {}),
    ...(observation.videos !== undefined ? { videos: observation.videos } : {}),
    ...(observation.videoTimingUnavailable !== undefined ? { videoTimingUnavailable: observation.videoTimingUnavailable } : {}),
  }
}

function legacyResultToOutcome(result: PowerPointPollResult | null): BridgePollOutcome | null {
  if (!result) return null
  if (result.state === 'none') {
    return {
      kind: 'powerpoint_not_running',
      warnings: [],
      extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 },
    }
  }
  const observation: PowerPointObservation = { ...result, state: result.state }
  const base = {
    warnings: [],
    extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 },
  }
  if (result.inSlideshow === false) return { kind: 'no_slideshow', observation, ...base }
  return { kind: 'observation', observation, ...base }
}

/** Existing Companion room/cue effect. Keep its event order and payload rules host-owned. */
function applyCommittedSnapshot(snapshot: PresentationSnapshot | null): void {
  const roomIds = getPresentationRoomIds()
  if (!snapshot) {
    if (!pptAnnouncedSnapshot) return
    const cueId = `powerpoint:${pptAnnouncedSnapshot.instanceId}`
    if (pptActiveCue) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' }
      roomIds.forEach((roomId) => {
        emitLiveCueEnded(roomId, endedCue)
        emitPresentationClear(roomId, cueId)
      })
    } else {
      roomIds.forEach((roomId) => emitPresentationClear(roomId, cueId))
    }
    pptAnnouncedSnapshot = null
    pptActiveCue = null
    return
  }

  const cueId = `powerpoint:${snapshot.instanceId}`
  const startedAt = pptActiveCue?.id === cueId ? pptActiveCue.startedAt ?? Date.now() : Date.now()
  const cue = buildPowerPointCue(snapshot, startedAt)

  if (!pptActiveCue || pptActiveCue.id !== cueId) {
    if (pptActiveCue && pptActiveCue.id !== cueId) {
      const endedCue: LiveCue = { ...pptActiveCue, status: 'ended' }
      roomIds.forEach((roomId) => emitLiveCueEnded(roomId, endedCue))
    }
    roomIds.forEach((roomId) => {
      emitLiveCueCreated(roomId, cue)
      emitPresentationLoaded(roomId, cue)
    })
  } else {
    roomIds.forEach((roomId) => {
      emitLiveCueUpdated(roomId, cue)
      emitPresentationUpdate(roomId, cue)
    })
  }

  pptActiveCue = cue
  pptAnnouncedSnapshot = snapshot
}

const presentationSession = new PowerPointSession({
  transport: {
    poll: async () => legacyResultToOutcome(await fetchPowerPointStatus()),
  },
  onTransition: (result) => {
    if (result.action?.kind === 'commit_snapshot') applyCommittedSnapshot(result.action.targetSnapshot)
    if (result.action?.kind === 'commit_clear') applyCommittedSnapshot(null)
  },
})

export function commitPresentationSnapshot(snapshot: PresentationSnapshot | null): void {
  presentationSession.synchronizeCommittedSnapshot(snapshot)
  applyCommittedSnapshot(snapshot)
}

export function updatePresentationCandidate(snapshot: PresentationSnapshot | null): void {
  presentationSession.acceptCandidate(snapshot, Date.now())
}

export function handlePowerPointStatus(result: PowerPointPollResult | null): void {
  if (!result) {
    logPptVerbose('[ppt] status: null')
    presentationSession.acceptPollResult(null, Date.now())
    return
  }
  logPptVerbose('[ppt] status', result)
  presentationSession.acceptPollResult(result, Date.now())
}

export function startPowerPointDetection(): void {
  if (presentationSession.isPolling()) return
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    if (isPptDebugEnabled()) logPptInfo('[ppt] detection disabled: unsupported platform')
    return
  }
  if (!getCompanionCapabilities().powerpoint) {
    if (isPptDebugEnabled()) logPptInfo('[ppt] detection disabled: capability false')
    return
  }

  if (isPptDebugEnabled()) logPptInfo('[ppt] detection started', { platform: process.platform })
  void appendPptLog(`[ppt] detection start mode=${getCompanionMode()} caps=${JSON.stringify(getCompanionCapabilities())}`)
  presentationSession.start()
}

export function isPowerPointDetectionActive(): boolean {
  return presentationSession.isPolling()
}

export function stopPowerPointDetectionTimer(): void {
  presentationSession.stopPolling()
}
