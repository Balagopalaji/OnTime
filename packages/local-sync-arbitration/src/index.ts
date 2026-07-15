// rebuild-target: packages/local-sync-arbitration
import type { Room, Timer } from '@ontime/shared-types'

export { mergeQueuedEvents } from './queue-merge'
export type { QueuedEvent } from './queue-merge'
export { mergeCueQueueEvents } from './queue-merge'
export type { CueQueuedEvent } from './queue-merge'
export { mergeControllerClients } from './controller-client-merge'
export { resolveQueuedCompanionLockReplayState, resolveQueuedCompanionLockReplayCallbackState } from './lock-replay-arbitration'
export { buildRoomFromCompanion, toCompanionRoomState, buildDefaultCompanionState, translateCompanionStateToFirebase } from './companion-room-state'
export { DEFAULT_ROOM_CONFIG, DEFAULT_FEATURES, DEFAULT_ROOM_STATE } from './companion-room-state'

export type ArbitrationDomain = 'room' | 'lock' | 'pin' | 'timer' | 'cue' | 'liveCue'

export type ArbitrationInput = {
  roomId: string
  domain: ArbitrationDomain
  resourceId?: string
  cloudTs?: number | null
  companionTs?: number | null
  authoritySource?: 'cloud' | 'companion'
  mode: 'auto' | 'cloud' | 'local'
  effectiveMode: 'cloud' | 'local'
  isCompanionLive: boolean
  cloudOnline: boolean
  confidenceWindowMs: number
  skewThreshold?: number
  controllerTieBreaker?: 'cloud' | 'companion'
  viewerSyncGuard?: boolean
  holdActive?: boolean
  allowFallbackToMode?: boolean
  preferSource?: 'cloud' | 'companion'
}

export type ArbitrationDecision = {
  acceptSource: 'cloud' | 'companion'
  reason:
    | 'cloud newer'
    | 'companion newer'
    | 'within window - authority'
    | 'within window - tie breaker'
    | 'mode bias'
    | 'cloud offline'
    | 'companion offline'
    | 'viewer sync guard'
    | 'hold active'
    | 'no data'
    | 'skew - authority fallback'
}

export type ArbitrationLastAcceptedCache = {
  get: (key: string) => ArbitrationDecision['acceptSource'] | undefined
  set: (key: string, source: ArbitrationDecision['acceptSource']) => void
}

export type ArbitrationOptions = {
  onDecision?: (input: ArbitrationInput, decision: ArbitrationDecision) => void
  lastAcceptedSourceCache?: ArbitrationLastAcceptedCache
}

export const ARBITRATION_FLAGS = {
  room: true,
  lock: true,
  pin: false,
  timer: false,
  cue: false,
  liveCue: false,
} as const

type AcceptedSource = ArbitrationDecision['acceptSource']

const keyFor = (input: ArbitrationInput): string =>
  `${input.domain}:${input.resourceId ?? input.roomId}`

const pickModeBias = (input: ArbitrationInput): AcceptedSource => {
  if (input.mode === 'cloud') return 'cloud'
  if (input.mode === 'local') return 'companion'
  return input.effectiveMode === 'local' ? 'companion' : 'cloud'
}

const commitDecision = (
  input: ArbitrationInput,
  decision: ArbitrationDecision,
  options?: ArbitrationOptions
) => {
  options?.lastAcceptedSourceCache?.set(keyFor(input), decision.acceptSource)
  options?.onDecision?.(input, decision)
  return decision
}

export const arbitrate = (
  input: ArbitrationInput,
  options?: ArbitrationOptions
): ArbitrationDecision => {
  const key = keyFor(input)
  const lastAccepted = options?.lastAcceptedSourceCache?.get(key)
  // `0` is the never-cached sentinel for state.lastUpdate (see resolveSnapshotTimestamp),
  // NOT a real wall-clock anchor. Treat ===0 as MISSING so a never-cached side routes
  // through the no-data / missing-timestamp branches instead of computing a huge
  // |0 - realTs| delta that always trips the skew guard (FIX-097).
  const hasCloudData =
    input.cloudTs !== null && input.cloudTs !== undefined && input.cloudTs !== 0
  const hasCompanionData =
    input.companionTs !== null && input.companionTs !== undefined && input.companionTs !== 0
  const cloudHasTimestamp =
    typeof input.cloudTs === 'number' && input.cloudTs !== 0 && Number.isFinite(input.cloudTs)
  const companionHasTimestamp =
    typeof input.companionTs === 'number' && input.companionTs !== 0 && Number.isFinite(input.companionTs)
  const skewThreshold = input.skewThreshold ?? 10 * 60 * 1000
  const allowFallbackToMode = input.allowFallbackToMode ?? true
  const preferSource = input.preferSource
  const authoritySource = input.authoritySource

  // 1) Both offline: keep last accepted; otherwise fallback by domain and mode.
  if (!input.isCompanionLive && !input.cloudOnline) {
    if (lastAccepted) {
      return commitDecision(input, { acceptSource: lastAccepted, reason: 'no data' }, options)
    }

    if (input.domain === 'room' && authoritySource) {
      return commitDecision(input, { acceptSource: authoritySource, reason: 'no data' }, options)
    }

    const fallback = pickModeBias(input)
    return commitDecision(input, { acceptSource: fallback, reason: 'no data' }, options)
  }

  // 2) Companion offline
  if (!input.isCompanionLive) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'companion offline' }, options)
  }

  // 3) Cloud offline
  if (!input.cloudOnline) {
    return commitDecision(input, { acceptSource: 'companion', reason: 'cloud offline' }, options)
  }

  // 4) Viewer sync guard
  if (input.viewerSyncGuard) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'viewer sync guard' }, options)
  }

  let withinWindow = false
  let skewed = false
  if (cloudHasTimestamp && companionHasTimestamp) {
    const cloudTs = input.cloudTs as number
    const companionTs = input.companionTs as number
    const delta = Math.abs(cloudTs - companionTs)
    withinWindow = delta <= input.confidenceWindowMs
    skewed = delta > skewThreshold
  }

  // 5) Hold window (only within confidence window, skew guard overrides)
  if (input.holdActive && withinWindow && !skewed) {
    const holdSource = preferSource ?? authoritySource ?? pickModeBias(input)
    return commitDecision(input, { acceptSource: holdSource, reason: 'hold active' }, options)
  }

  // 6) Skew guard: beyond the threshold, timestamps can't be trusted as absolute
  // (clock drift vs a genuinely-stale side is indistinguishable). Fall back to the
  // room's authority/mode — the same fallback used when neither side has data —
  // rather than hardcoding cloud or trusting the apparently-"newer" side.
  // See docs/rebuild-arbitration-decisions.md §1 (skew policy).
  if (skewed) {
    const skewFallback = authoritySource ?? pickModeBias(input)
    return commitDecision(input, { acceptSource: skewFallback, reason: 'skew - authority fallback' }, options)
  }

  // 7) Both online but no data on either side
  if (!hasCloudData && !hasCompanionData) {
    if (lastAccepted) {
      return commitDecision(input, { acceptSource: lastAccepted, reason: 'no data' }, options)
    }

    if (input.domain === 'room' && authoritySource) {
      return commitDecision(input, { acceptSource: authoritySource, reason: 'no data' }, options)
    }

    const fallback = pickModeBias(input)
    return commitDecision(input, { acceptSource: fallback, reason: 'no data' }, options)
  }

  // 8) One side has no data
  if (!hasCloudData && hasCompanionData) {
    return commitDecision(input, { acceptSource: 'companion', reason: 'no data' }, options)
  }

  if (hasCloudData && !hasCompanionData) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'no data' }, options)
  }

  // 9) Missing timestamps: fallback to preferSource or mode bias
  if (!cloudHasTimestamp || !companionHasTimestamp) {
    if (preferSource) {
      return commitDecision(input, { acceptSource: preferSource, reason: 'mode bias' }, options)
    }

    if (allowFallbackToMode) {
      const fallback = pickModeBias(input)
      return commitDecision(input, { acceptSource: fallback, reason: 'mode bias' }, options)
    }

    if (authoritySource) {
      return commitDecision(
        input,
        { acceptSource: authoritySource, reason: 'within window - authority' },
        options
      )
    }
  }

  // 10) Equal timestamps with tie breaker
  if (cloudHasTimestamp && companionHasTimestamp) {
    const cloudTs = input.cloudTs as number
    const companionTs = input.companionTs as number
    if (cloudTs === companionTs && input.controllerTieBreaker) {
      return commitDecision(
        input,
        {
          acceptSource: input.controllerTieBreaker,
          reason: 'within window - tie breaker',
        },
        options
      )
    }
  }

  // 11) Within confidence window: prefer authority or preferSource
  if (withinWindow) {
    const authorityPick = preferSource ?? authoritySource
    if (authorityPick) {
      return commitDecision(
        input,
        {
          acceptSource: authorityPick,
          reason: 'within window - authority',
        },
        options
      )
    }
  }

  // 12) Newer wins
  if (cloudHasTimestamp && companionHasTimestamp) {
    const cloudTs = input.cloudTs as number
    const companionTs = input.companionTs as number
    if (cloudTs > companionTs) {
      return commitDecision(input, { acceptSource: 'cloud', reason: 'cloud newer' }, options)
    }

    if (companionTs > cloudTs) {
      return commitDecision(input, { acceptSource: 'companion', reason: 'companion newer' }, options)
    }
  }

  // 13) Mode bias fallback
  const fallback = preferSource ?? (allowFallbackToMode ? pickModeBias(input) : authoritySource) ?? 'cloud'
  return commitDecision(input, { acceptSource: fallback, reason: 'mode bias' }, options)
}

/**
 * Resolve the freshness timestamp for an incoming room-state snapshot.
 *
 * Contract: a live broadcast's freshness anchor is the envelope `timestamp`
 * (emit time) whenever `state.lastUpdate` is the sentinel `0` (never-cached
 * room). A real `lastUpdate` (>0) always takes precedence. `lastUpdate` is
 * wall-clock ms; `0` means "never cached" (see companion `getRoomState`),
 * NOT a real anchor — so `||` (not `??`) is correct. Using `??` here would
 * let a `0` sentinel become the anchor, falsely losing arbitration and
 * dropping the live snapshot (7th-audit MINOR-1).
 */
export const resolveSnapshotTimestamp = (
  stateLastUpdate: number | undefined,
  envelopeTimestamp: number | undefined,
  now: number = Date.now(),
): number => {
  return stateLastUpdate || envelopeTimestamp || now
}

// Reconnect/authority reconciliation helpers carved byte-faithful from
// frontend/src/context/UnifiedDataContext.tsx (Stage 1b U4).

export const normalizeRoomAuthoritySource = (
  source: 'cloud' | 'companion' | 'pending',
): 'cloud' | 'companion' | undefined => {
  if (source === 'pending') return undefined
  return source
}

const BASE_CONFIDENCE_WINDOW_MS = 2000
const CHURN_CONFIDENCE_WINDOW_MS = 4000

export const getConfidenceWindowMs = (hasReconnectChurn: boolean): number =>
  hasReconnectChurn ? CHURN_CONFIDENCE_WINDOW_MS : BASE_CONFIDENCE_WINDOW_MS

export type ResolveRoomSourceInput = {
  roomId: string
  isCompanionLive: boolean
  viewerSyncGuard: boolean
  firebaseTs: number
  companionTs: number
  authoritySource: 'cloud' | 'companion' | 'pending'
  mode: 'auto' | 'cloud' | 'local'
  effectiveMode: 'cloud' | 'local'
  confidenceWindowMs: number
  controllerTieBreaker?: 'cloud' | 'companion'
  cloudOnline: boolean
  holdActive?: boolean
  preferSource?: 'cloud' | 'companion'
  // Defaults to core arbitrate; the app shim injects its wrapped arbitrate (cache + logging)
  // so the carved function stays byte-faithful to the pre-extraction behavior.
  arbitrateFn?: (input: ArbitrationInput, options?: ArbitrationOptions) => ArbitrationDecision
}

export const resolveRoomSource = (input: ResolveRoomSourceInput): 'cloud' | 'companion' => {
  const { arbitrateFn = arbitrate, firebaseTs, authoritySource, ...rest } = input
  const decision = arbitrateFn({
    ...rest,
    domain: 'room',
    cloudTs: firebaseTs,
    authoritySource: normalizeRoomAuthoritySource(authoritySource),
  })
  return decision.acceptSource
}

export const shouldBootstrapCachedSubscriptions = ({
  hasBootstrapped,
  hasSocket,
  hasToken,
  cachedSubscriptions,
}: {
  hasBootstrapped: boolean
  hasSocket: boolean
  hasToken: boolean
  cachedSubscriptions: Record<string, unknown>
}): boolean => {
  if (hasBootstrapped) return false
  if (!hasSocket || !hasToken) return false
  return Object.keys(cachedSubscriptions).length > 0
}

export const resolveReconciledTimerTargetId = ({
  requestedTimerId,
  activeTimerId,
  timers,
}: {
  requestedTimerId?: string | null
  activeTimerId?: string | null
  timers: Timer[]
}): string | null => {
  if (timers.length === 0) {
    return requestedTimerId ?? activeTimerId ?? null
  }

  const timerIds = new Set(timers.map((timer) => timer.id))
  if (requestedTimerId && timerIds.has(requestedTimerId)) return requestedTimerId
  if (activeTimerId && timerIds.has(activeTimerId)) return activeTimerId
  return timers[0]?.id ?? null
}

export const isSnapshotStale = (
  state: Room['state'],
  snapshotTimestamp: number,
  now: number = Date.now(),
  timer?: Timer,
): boolean => {
  const age = now - snapshotTimestamp
  // Do not clamp; bonus time can make elapsed negative.
  const baseElapsed = (state.elapsedOffset ?? state.currentTime ?? 0) as number
  const hasProgress =
    baseElapsed !== 0 || Object.values(state.progress ?? {}).some((val) => (val ?? 0) !== 0)
  const adjustments = timer?.adjustmentLog?.filter(
    (entry) => entry.timestamp > snapshotTimestamp && entry.timestamp < now,
  ) ?? []
  const totalAdjustments = adjustments.reduce((sum, entry) => sum + entry.delta, 0)
  const adjustedElapsed = baseElapsed + age + totalAdjustments

  if (state.isRunning) {
    if (timer?.duration) {
      return adjustedElapsed > timer.duration * 1000 * 3
    }
    return age > 30_000
  }

  if (hasProgress) {
    return age > 24 * 60 * 60 * 1000
  }

  return false
}
