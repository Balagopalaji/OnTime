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
