export const MAX_RESPONSE_BYTES = 1_048_576
/** Protocol v1 requires an explicit helper-owned primary for non-empty media lists. */
export const EXPLICIT_PRIMARY_PROTOCOL_VERSION = 1

export type PowerPointState = 'foreground' | 'background' | 'none'
export type PowerPointVideoStatus = 'playing' | 'paused' | 'ended'

export type PowerPointVideoObservation = {
  id?: number
  name?: string
  duration?: number
  elapsed?: number
  remaining?: number
  playing?: boolean
  status?: PowerPointVideoStatus
}

export type PowerPointObservation = {
  state: Exclude<PowerPointState, 'none'>
  pptActive?: boolean
  inSlideshow?: boolean
  videoDetected?: boolean
  videoPlaying?: boolean
  videoTimingUnavailable?: boolean
  affinityMismatch?: boolean
  instanceId?: number
  slideNumber?: number
  totalSlides?: number
  primaryVideoId?: number
  primaryVideoIndex?: number
  processCount?: number
  selectedPid?: number
  comPid?: number
  protocolVersion?: number
  /** Product version embedded in the native helper assembly at publish time. */
  productVersion?: string
  videoDuration?: number
  videoElapsed?: number
  videoRemaining?: number
  title?: string
  filename?: string
  videos?: PowerPointVideoObservation[]
  editSlideVideos?: PowerPointVideoObservation[]
}

export type ValidationWarningCode =
  | 'invalid_optional_type'
  | 'invalid_optional_number'
  | 'invalid_video_entry'
  | 'invalid_video_field'
  | 'unknown_fields_present'

export type ValidationWarning = {
  code: ValidationWarningCode
  path: string
}

export type ExtensionSummary = {
  rootUnknownFieldCount: number
  videoUnknownFieldCount: number
  editSlideVideoUnknownFieldCount: number
}

type OutcomeBase = {
  warnings: ValidationWarning[]
  extensions: ExtensionSummary
}

export type ObservationOutcome = OutcomeBase & {
  kind: 'observation'
  observation: PowerPointObservation
}

export type AvailabilityOutcome =
  | (OutcomeBase & { kind: 'powerpoint_not_running' })
  | (OutcomeBase & { kind: 'no_slideshow'; observation: PowerPointObservation })
  | (OutcomeBase & { kind: 'com_unavailable' })

export type FailureOutcome = OutcomeBase & {
  kind:
    | 'helper_missing'
    | 'timeout'
    | 'process_exit'
    | 'invalid_json'
    | 'invalid_payload'
    | 'oversized_response'
    | 'closed'
  generation?: number
  code?: number
}

export type BridgePollOutcome = ObservationOutcome | AvailabilityOutcome | FailureOutcome

export type HelperLaunchCandidate = {
  executablePath: string
  args?: readonly string[]
}
