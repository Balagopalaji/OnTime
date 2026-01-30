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
}

export const ARBITRATION_FLAGS = {
  room: true,
  lock: true,
  pin: false,
  timer: false,
  cue: false,
  liveCue: false,
} as const

type AcceptedSource = 'cloud' | 'companion'

const lastAcceptedSource: Record<string, AcceptedSource> = {}

const keyFor = (input: ArbitrationInput): string =>
  `${input.domain}:${input.resourceId ?? input.roomId}`

const logDecision = (input: ArbitrationInput, decision: ArbitrationDecision) => {
  if (import.meta.env.VITE_DEBUG_ARBITRATION === 'true') {
    console.info('[arbitration]', {
      domain: input.domain,
      roomId: input.roomId,
      resourceId: input.resourceId,
      decision,
    })
  }
}

const pickModeBias = (input: ArbitrationInput): AcceptedSource => {
  if (input.mode === 'cloud') return 'cloud'
  if (input.mode === 'local') return 'companion'
  return input.effectiveMode === 'local' ? 'companion' : 'cloud'
}

const commitDecision = (input: ArbitrationInput, decision: ArbitrationDecision) => {
  lastAcceptedSource[keyFor(input)] = decision.acceptSource
  logDecision(input, decision)
  return decision
}

export const arbitrate = (input: ArbitrationInput): ArbitrationDecision => {
  const key = keyFor(input)
  const lastAccepted = lastAcceptedSource[key]
  const hasCloudData = input.cloudTs !== null && input.cloudTs !== undefined
  const hasCompanionData = input.companionTs !== null && input.companionTs !== undefined
  const cloudHasTimestamp = typeof input.cloudTs === 'number' && Number.isFinite(input.cloudTs)
  const companionHasTimestamp =
    typeof input.companionTs === 'number' && Number.isFinite(input.companionTs)
  const skewThreshold = input.skewThreshold ?? 10 * 60 * 1000
  const allowFallbackToMode = input.allowFallbackToMode ?? true
  const preferSource = input.preferSource
  const authoritySource = input.authoritySource

  // 1) Both offline: keep last accepted; otherwise fallback by domain and mode.
  if (!input.isCompanionLive && !input.cloudOnline) {
    if (lastAccepted) {
      return commitDecision(input, { acceptSource: lastAccepted, reason: 'no data' })
    }

    if (input.domain === 'room' && authoritySource) {
      return commitDecision(input, { acceptSource: authoritySource, reason: 'no data' })
    }

    const fallback = pickModeBias(input)
    return commitDecision(input, { acceptSource: fallback, reason: 'no data' })
  }

  // 2) Companion offline
  if (!input.isCompanionLive) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'companion offline' })
  }

  // 3) Cloud offline
  if (!input.cloudOnline) {
    return commitDecision(input, { acceptSource: 'companion', reason: 'cloud offline' })
  }

  // 4) Viewer sync guard
  if (input.viewerSyncGuard) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'viewer sync guard' })
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
    return commitDecision(input, { acceptSource: holdSource, reason: 'hold active' })
  }

  // 6) Skew guard
  if (skewed) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'cloud newer' })
  }

  // 7) Both online but no data on either side
  if (!hasCloudData && !hasCompanionData) {
    if (lastAccepted) {
      return commitDecision(input, { acceptSource: lastAccepted, reason: 'no data' })
    }

    if (input.domain === 'room' && authoritySource) {
      return commitDecision(input, { acceptSource: authoritySource, reason: 'no data' })
    }

    const fallback = pickModeBias(input)
    return commitDecision(input, { acceptSource: fallback, reason: 'no data' })
  }

  // 8) One side has no data
  if (!hasCloudData && hasCompanionData) {
    return commitDecision(input, { acceptSource: 'companion', reason: 'no data' })
  }

  if (hasCloudData && !hasCompanionData) {
    return commitDecision(input, { acceptSource: 'cloud', reason: 'no data' })
  }

  // 9) Missing timestamps: fallback to preferSource or mode bias
  if (!cloudHasTimestamp || !companionHasTimestamp) {
    if (preferSource) {
      return commitDecision(input, { acceptSource: preferSource, reason: 'mode bias' })
    }

    if (allowFallbackToMode) {
      const fallback = pickModeBias(input)
      return commitDecision(input, { acceptSource: fallback, reason: 'mode bias' })
    }

    if (authoritySource) {
      return commitDecision(input, { acceptSource: authoritySource, reason: 'within window - authority' })
    }
  }

  // 10) Equal timestamps with tie breaker
  if (cloudHasTimestamp && companionHasTimestamp) {
    const cloudTs = input.cloudTs as number
    const companionTs = input.companionTs as number
    if (cloudTs === companionTs && input.controllerTieBreaker) {
      return commitDecision(input, {
        acceptSource: input.controllerTieBreaker,
        reason: 'within window - tie breaker',
      })
    }
  }

  // 11) Within confidence window: prefer authority or preferSource
  if (withinWindow) {
    const authorityPick = preferSource ?? authoritySource
    if (authorityPick) {
      return commitDecision(input, {
        acceptSource: authorityPick,
        reason: 'within window - authority',
      })
    }
  }

  // 12) Newer wins
  if (cloudHasTimestamp && companionHasTimestamp) {
    const cloudTs = input.cloudTs as number
    const companionTs = input.companionTs as number
    if (cloudTs > companionTs) {
      return commitDecision(input, { acceptSource: 'cloud', reason: 'cloud newer' })
    }

    if (companionTs > cloudTs) {
      return commitDecision(input, { acceptSource: 'companion', reason: 'companion newer' })
    }
  }

  // 13) Mode bias fallback
  const fallback = preferSource ?? (allowFallbackToMode ? pickModeBias(input) : authoritySource) ?? 'cloud'
  return commitDecision(input, { acceptSource: fallback, reason: 'mode bias' })
}
