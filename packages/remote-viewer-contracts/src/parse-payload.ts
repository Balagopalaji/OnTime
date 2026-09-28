import { sanitizeDisplayText } from './sanitize'
import {
  MAX_VIDEO_ROWS,
  type PowerPointPresentationPayloadV1,
  type PowerPointPresentationState,
  type PowerPointUnavailablePayloadV1,
  type PowerPointUnavailableReason,
  type RemoteSourceBody,
  type RemoteVideoRowV1,
} from './snapshot-types'
import {
  expectBoolean,
  expectEnum,
  expectInteger,
  expectNullableInteger,
  expectNullableNonNegative,
  expectOptionalString,
  expectRecord,
  join,
  reject,
  type UnknownRecord,
} from './strict'

const AVAILABILITIES = ['connecting', 'active', 'source-unavailable'] as const
const UNAVAILABLE_REASONS: readonly PowerPointUnavailableReason[] = ['no-presentation', 'no-slideshow', 'helper-unavailable']
const PRESENTATION_STATES: readonly PowerPointPresentationState[] = [
  'no-video',
  'timing-unavailable',
  'ready',
  'playing',
  'paused',
  'ended',
]
const ROW_STATUSES = ['ready', 'playing', 'paused', 'ended'] as const
const TIMING_FIELDS = ['durationMs', 'elapsedMsAtObservation', 'remainingMsAtObservation'] as const

const UNAVAILABLE_KEYS = new Set(['reason'])
const PRESENTATION_KEYS = new Set([
  'reason',
  'presentationState',
  'slideNumber',
  'slideCount',
  'displayTitle',
  'headline',
  'videos',
])
const PAYLOAD_KEYS = new Set([...PRESENTATION_KEYS, ...UNAVAILABLE_KEYS])
const HEADLINE_KEYS = new Set(['focusedOrdinal', 'mode', 'timingMode'])
const ROW_KEYS = new Set(['ordinal', 'label', 'status', ...TIMING_FIELDS, 'isFocus'])

function optionalDisplayText(record: UnknownRecord, key: string, path: string): string | undefined {
  const raw = expectOptionalString(record, key, path)
  return raw === undefined ? undefined : sanitizeDisplayText(raw)
}

function parseRow(value: unknown, path: string, state: PowerPointPresentationState): RemoteVideoRowV1 {
  const record = expectRecord(value, path, ROW_KEYS)
  const ordinal = expectInteger(record, 'ordinal', path, 0)
  const label = optionalDisplayText(record, 'label', path)
  const status = expectEnum(record, 'status', path, ROW_STATUSES)
  const timing = TIMING_FIELDS.map((key) => expectNullableNonNegative(record, key, path))
  const isFocus = expectBoolean(record, 'isFocus', path)

  TIMING_FIELDS.forEach((key, index) => {
    const measured = timing[index] !== null
    // Timing-unavailable publishes identity only; a playing row otherwise must be interpolable.
    if (state === 'timing-unavailable' ? measured : status === 'playing' && !measured) {
      reject('invalid-combination', join(path, key))
    }
  })

  const [durationMs, elapsedMsAtObservation, remainingMsAtObservation] = timing as [
    number | null,
    number | null,
    number | null,
  ]
  return {
    ordinal,
    ...(label === undefined ? {} : { label }),
    status,
    durationMs,
    elapsedMsAtObservation,
    remainingMsAtObservation,
    isFocus,
  }
}

function parseRows(value: unknown, path: string, state: PowerPointPresentationState): RemoteVideoRowV1[] {
  if (!Array.isArray(value) || value.length > MAX_VIDEO_ROWS) reject('invalid-field', path)
  const rows: RemoteVideoRowV1[] = []
  let focusSeen = false
  // Indexed loop so a sparse hole is rejected rather than skipped.
  for (let index = 0; index < value.length; index += 1) {
    const rowPath = join(path, index)
    const row = parseRow(value[index], rowPath, state)
    const previous = rows[rows.length - 1]
    if (previous !== undefined && row.ordinal <= previous.ordinal) reject('invalid-combination', join(rowPath, 'ordinal'))
    if (row.isFocus && focusSeen) reject('invalid-combination', join(rowPath, 'isFocus'))
    focusSeen ||= row.isFocus
    rows.push(row)
  }
  if ((state === 'no-video') !== (rows.length === 0)) reject('invalid-combination', path)
  return rows
}

/**
 * Host projection derives `presentationState` from the same resolved statuses
 * as the rows: any playing row makes the slide `playing` (or
 * `timing-unavailable`), and a `playing` slide has a playing row.
 */
function assertStateMatchesRows(state: PowerPointPresentationState, rows: readonly RemoteVideoRowV1[], path: string): void {
  if (state === 'no-video' || state === 'timing-unavailable') return
  const anyPlaying = rows.some((row) => row.status === 'playing')
  if ((state === 'playing') !== anyPlaying) reject('invalid-combination', join(path, 'presentationState'))
}

function parsePresentation(record: UnknownRecord, path: string): PowerPointPresentationPayloadV1 {
  expectRecord(record, path, PRESENTATION_KEYS)
  const presentationState = expectEnum(record, 'presentationState', path, PRESENTATION_STATES)
  const slideNumber = expectNullableInteger(record, 'slideNumber', path, 1)
  const slideCount = expectNullableInteger(record, 'slideCount', path, 1)
  if (slideNumber !== null && slideCount !== null && slideNumber > slideCount) {
    reject('invalid-combination', join(path, 'slideNumber'))
  }
  const displayTitle = optionalDisplayText(record, 'displayTitle', path)

  const headlinePath = join(path, 'headline')
  const headlineRecord = expectRecord(record.headline, headlinePath, HEADLINE_KEYS)
  const focusedOrdinal = expectNullableInteger(headlineRecord, 'focusedOrdinal', headlinePath, 0)
  const mode = expectEnum(headlineRecord, 'mode', headlinePath, ['longest-remaining', 'latest-started'] as const)
  const timingMode = expectEnum(headlineRecord, 'timingMode', headlinePath, ['remaining', 'elapsed'] as const)

  const videos = parseRows(record.videos, join(path, 'videos'), presentationState)
  assertStateMatchesRows(presentationState, videos, path)
  const focusRow = videos.find((row) => row.isFocus)
  if (focusedOrdinal !== (focusRow?.ordinal ?? null)) reject('invalid-combination', join(headlinePath, 'focusedOrdinal'))

  return {
    reason: 'presentation',
    presentationState,
    slideNumber,
    slideCount,
    ...(displayTitle === undefined ? {} : { displayTitle }),
    headline: { focusedOrdinal, mode, timingMode },
    videos,
  }
}

function parseUnavailable(record: UnknownRecord, path: string): PowerPointUnavailablePayloadV1 {
  expectRecord(record, path, UNAVAILABLE_KEYS)
  return { reason: expectEnum(record, 'reason', path, UNAVAILABLE_REASONS) }
}

/**
 * Parse the coupled availability/payload pair shared by the candidate,
 * publish request, and stored snapshot. Always reconstructs new objects.
 */
export function parseSourceBody(record: UnknownRecord): RemoteSourceBody {
  const availability = expectEnum(record, 'availability', '', AVAILABILITIES)
  const payload = record.payload
  if (!('payload' in record)) reject('invalid-field', 'payload')

  if (availability === 'connecting') {
    if (payload !== null) reject('invalid-combination', 'payload')
    return { availability, payload: null }
  }
  if (payload === null) reject('invalid-combination', 'payload')
  // Shape/prototype/key check before reading the discriminant, so no getter runs first.
  const payloadRecord = expectRecord(payload, 'payload', PAYLOAD_KEYS)
  const isPresentation = payloadRecord.reason === 'presentation'

  if (availability === 'active') {
    if (!isPresentation) reject('invalid-combination', 'payload.reason')
    return { availability, payload: parsePresentation(payloadRecord, 'payload') }
  }
  if (isPresentation) reject('invalid-combination', 'payload.reason')
  return { availability, payload: parseUnavailable(payloadRecord, 'payload') }
}
