import {
  MAX_RESPONSE_BYTES,
  type BridgePollOutcome,
  type ExtensionSummary,
  type PowerPointObservation,
  type PowerPointState,
  type PowerPointVideoObservation,
  type ValidationWarning,
  type ValidationWarningCode,
} from './protocol.js'

const rootFields = new Set([
  'state', 'pptActive', 'pptError', 'inSlideshow', 'videoDetected', 'videoPlaying',
  'videoTimingUnavailable', 'affinityMismatch', 'instanceId', 'slideNumber', 'totalSlides',
  'primaryVideoId', 'primaryVideoIndex', 'processCount', 'selectedPid', 'comPid',
  'protocolVersion', 'videoDuration', 'videoElapsed', 'videoRemaining', 'title', 'filename',
  'videos', 'editSlideVideos',
])
const videoFields = new Set(['id', 'name', 'duration', 'elapsed', 'remaining', 'playing', 'status'])
const integerFields = new Set([
  'instanceId', 'slideNumber', 'totalSlides', 'primaryVideoId', 'primaryVideoIndex',
  'processCount', 'selectedPid', 'comPid', 'protocolVersion',
])
const numericFields = new Set(['videoDuration', 'videoElapsed', 'videoRemaining'])
const booleanFields = new Set([
  'pptActive', 'inSlideshow', 'videoDetected', 'videoPlaying', 'videoTimingUnavailable', 'affinityMismatch',
])
const stringFields = new Set(['title', 'filename'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function warning(
  warnings: ValidationWarning[],
  code: ValidationWarningCode,
  path: string,
): void {
  if (warnings.length >= 32) return
  warnings.push({ code, path })
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonNegativeInteger(value: unknown): value is number {
  return finiteNonNegative(value) && Number.isInteger(value)
}

function sanitizeVideo(
  value: unknown,
  path: string,
  warningBucket: 'videoUnknownFieldCount' | 'editSlideVideoUnknownFieldCount',
  warnings: ValidationWarning[],
  extensions: ExtensionSummary,
): PowerPointVideoObservation | undefined {
  if (!isRecord(value)) {
    warning(warnings, 'invalid_video_entry', path)
    return undefined
  }
  const result: PowerPointVideoObservation = {}
  let recognized = 0
  let unknown = 0
  for (const [key, raw] of Object.entries(value)) {
    if (!videoFields.has(key)) {
      unknown += 1
      continue
    }
    recognized += 1
    if (key === 'id') {
      if (nonNegativeInteger(raw)) result.id = raw
      else warning(warnings, 'invalid_video_field', `${path}.id`)
    } else if (key === 'name') {
      if (typeof raw === 'string') result.name = raw
      else warning(warnings, 'invalid_video_field', `${path}.name`)
    } else if (key === 'playing') {
      if (typeof raw === 'boolean') result.playing = raw
      else warning(warnings, 'invalid_video_field', `${path}.playing`)
    } else if (key === 'status') {
      if (raw === 'playing' || raw === 'paused' || raw === 'ended') result.status = raw
      else warning(warnings, 'invalid_video_field', `${path}.status`)
    } else if (finiteNonNegative(raw)) {
      result[key as 'duration' | 'elapsed' | 'remaining'] = raw
    } else {
      warning(warnings, 'invalid_video_field', `${path}.${key}`)
    }
  }
  if (unknown > 0) extensions[warningBucket] += unknown
  if (unknown > 0) warning(warnings, 'unknown_fields_present', path)
  if (recognized === 0 || Object.keys(result).length === 0) {
    warning(warnings, 'invalid_video_entry', path)
    return undefined
  }
  return result
}

function sanitizeVideoList(
  value: unknown,
  field: 'videos' | 'editSlideVideos',
  warnings: ValidationWarning[],
  extensions: ExtensionSummary,
): PowerPointVideoObservation[] | undefined {
  if (!Array.isArray(value)) {
    warning(warnings, 'invalid_optional_type', field)
    return undefined
  }
  const result = value
    .map((entry, index) => sanitizeVideo(
      entry,
      `${field}[${index}]`,
      field === 'videos' ? 'videoUnknownFieldCount' : 'editSlideVideoUnknownFieldCount',
      warnings,
      extensions,
    ))
    .filter((entry): entry is PowerPointVideoObservation => entry !== undefined)
  return result
}

function failure(kind: Extract<BridgePollOutcome['kind'], 'invalid_json' | 'invalid_payload' | 'oversized_response'>): BridgePollOutcome {
  return {
    kind,
    warnings: [],
    extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 },
  }
}

export function validatePowerPointResponse(line: string | Uint8Array): BridgePollOutcome {
  let bytes: Uint8Array
  let text: string
  try {
    if (typeof line === 'string') bytes = new TextEncoder().encode(line)
    else bytes = line
    if (bytes.byteLength > MAX_RESPONSE_BYTES) return failure('oversized_response')
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return failure('invalid_json')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return failure('invalid_json')
  }
  if (!isRecord(parsed) || !('state' in parsed)) return failure('invalid_payload')
  const state = parsed.state
  if (state !== 'foreground' && state !== 'background' && state !== 'none') return failure('invalid_payload')

  const warnings: ValidationWarning[] = []
  const extensions: ExtensionSummary = {
    rootUnknownFieldCount: 0,
    videoUnknownFieldCount: 0,
    editSlideVideoUnknownFieldCount: 0,
  }
  const observation: PowerPointObservation = { state: state as Exclude<PowerPointState, 'none'> }
  let pptError = false

  for (const [key, raw] of Object.entries(parsed)) {
    if (!rootFields.has(key)) {
      extensions.rootUnknownFieldCount += 1
      continue
    }
    if (key === 'state' || key === 'pptError') {
      if (key === 'pptError' && typeof raw === 'string' && raw.trim().length > 0) pptError = true
      else if (key === 'pptError' && raw !== undefined && typeof raw !== 'string') warning(warnings, 'invalid_optional_type', 'pptError')
      continue
    }
    if (booleanFields.has(key)) {
      if (typeof raw === 'boolean') (observation as Record<string, unknown>)[key] = raw
      else warning(warnings, 'invalid_optional_type', key)
    } else if (integerFields.has(key)) {
      if (nonNegativeInteger(raw)) (observation as Record<string, unknown>)[key] = raw
      else warning(warnings, 'invalid_optional_number', key)
    } else if (numericFields.has(key)) {
      if (finiteNonNegative(raw)) (observation as Record<string, unknown>)[key] = raw
      else warning(warnings, 'invalid_optional_number', key)
    } else if (stringFields.has(key)) {
      if (typeof raw === 'string') (observation as Record<string, unknown>)[key] = raw
      else warning(warnings, 'invalid_optional_type', key)
    } else if (key === 'videos' || key === 'editSlideVideos') {
      const list = sanitizeVideoList(raw, key, warnings, extensions)
      if (list !== undefined) (observation as Record<string, unknown>)[key] = list
    }
  }
  if (extensions.rootUnknownFieldCount > 0) warning(warnings, 'unknown_fields_present', 'root')

  const base = { warnings, extensions }
  if (pptError || observation.pptActive === false) return { kind: 'com_unavailable', ...base }
  if (state === 'none') return { kind: 'powerpoint_not_running', ...base }
  if (observation.inSlideshow === false) return { kind: 'no_slideshow', observation, ...base }
  return { kind: 'observation', observation, ...base }
}
