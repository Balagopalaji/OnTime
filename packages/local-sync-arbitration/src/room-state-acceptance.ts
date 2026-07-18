// rebuild-target: packages/local-sync-arbitration
import type { Room } from '@ontime/shared-types'
import { mergeProgress } from '@ontime/timer-core'
import {
  arbitrate,
  type ArbitrationDecision,
  type ArbitrationInput,
  type ArbitrationOptions,
} from './index'

// Room-state acceptance cluster carved byte-faithful from
// frontend/src/context/UnifiedDataContext.tsx (Stage 1b Lane A slice AR-2).
// Bodies are verbatim except the enumerated DI substitutions:
// Date.now() -> now, ARBITRATION_FLAGS.room -> flagEnabled, arbitrate -> arbitrateFn,
// payload.roomId -> roomId, snapshotTs/incomingTs -> incomingTs, and call-site
// expressions hoisted to the call sites as arguments.

export const resolveControllerTieBreaker = (
  lastControllerWrite: { source: 'cloud' | 'companion'; timestamp: number } | undefined,
  now: number,
  confidenceWindowMs: number,
): 'cloud' | 'companion' | undefined =>
  lastControllerWrite && now - lastControllerWrite.timestamp <= confidenceWindowMs
    ? lastControllerWrite.source
    : undefined

export type RoomStateAcceptanceInput = {
  roomId: string
  cloudTs: number | undefined
  incomingTs: number
  existingTs: number
  firebaseTs: number
  authoritySource: 'cloud' | 'companion' | undefined
  mode: 'auto' | 'cloud' | 'local'
  effectiveMode: 'cloud' | 'local'
  isCompanionLive: boolean
  cloudOnline: boolean
  confidenceWindowMs: number
  controllerTieBreaker?: 'cloud' | 'companion'
  viewerSyncGuard: boolean
  holdActive: boolean
  flagEnabled: boolean
  // Defaults to core arbitrate; the app shim injects its wrapped arbitrate (cache + logging)
  // so the carved function stays byte-faithful to the pre-extraction behavior.
  arbitrateFn?: (input: ArbitrationInput, options?: ArbitrationOptions) => ArbitrationDecision
}

export const decideRoomStateAcceptance = (
  input: RoomStateAcceptanceInput,
): { arbitrationDecision: ArbitrationDecision | null; isStale: boolean } => {
  const {
    roomId,
    cloudTs,
    incomingTs,
    existingTs,
    firebaseTs,
    authoritySource,
    mode,
    effectiveMode,
    isCompanionLive,
    cloudOnline,
    confidenceWindowMs,
    controllerTieBreaker,
    viewerSyncGuard,
    holdActive,
    flagEnabled,
    arbitrateFn = arbitrate,
  } = input
  const arbitrationDecision = flagEnabled
    ? arbitrateFn({
        roomId,
        domain: 'room',
        cloudTs,
        companionTs: incomingTs,
        authoritySource,
        mode,
        effectiveMode,
        isCompanionLive,
        cloudOnline,
        confidenceWindowMs,
        controllerTieBreaker,
        viewerSyncGuard,
        holdActive,
      })
    : null
  const isStale = flagEnabled
    ? arbitrationDecision?.acceptSource !== 'companion'
    : incomingTs + confidenceWindowMs < existingTs || incomingTs + confidenceWindowMs < firebaseTs
  return { arbitrationDecision, isStale }
}

export const mergeRoomProgressFromCache = (
  room: Room,
  cachedProgress: Record<string, number>,
): Room => {
  const hasCachedProgress = Object.keys(cachedProgress).length > 0
  if (!hasCachedProgress) return room
  // Shared mergeProgress helper: priority (fresh room progress) overrides base (cache).
  const roomProgress = room.state.progress ?? {}
  return {
    ...room,
    state: {
      ...room.state,
      progress: mergeProgress(cachedProgress, roomProgress),
    },
  }
}
