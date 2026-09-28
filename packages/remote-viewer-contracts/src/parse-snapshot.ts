import { parseSourceBody } from './parse-payload'
import {
  POWERPOINT_SOURCE_KIND,
  POWERPOINT_SOURCE_MAJOR,
  REMOTE_SCHEMA_MAJOR,
  SESSION_ID_PATTERN,
  type ParseResult,
  type PublishSnapshotRequestV1,
  type RemoteSnapshotCandidateV1,
  type RemoteSnapshotV1,
} from './snapshot-types'
import { expectInteger, expectNonNegative, expectRecord, reject, runParser, type UnknownRecord } from './strict'

const BODY_KEYS = ['schemaMajor', 'sourceKind', 'sourceMajor', 'observedAtMs', 'availability', 'payload']
const CANDIDATE_KEYS = new Set(BODY_KEYS)
const REQUEST_KEYS = new Set([
  ...BODY_KEYS,
  'sessionId',
  'epoch',
  'sequence',
  'observationAgeMs',
  'sentAtEstimatedServerMs',
])
const SNAPSHOT_KEYS = new Set([
  ...BODY_KEYS,
  'sessionId',
  'epoch',
  'sequence',
  'observationAgeMs',
  'preCommitTransitMs',
  'publishedAtMs',
  'heartbeatIntervalMs',
  'staleAfterMs',
  'disconnectAfterMs',
])

function parseHeader(record: UnknownRecord) {
  if (record.schemaMajor !== REMOTE_SCHEMA_MAJOR) reject('incompatible-version', 'schemaMajor')
  if (record.sourceKind !== POWERPOINT_SOURCE_KIND) reject('unsupported-source', 'sourceKind')
  if (record.sourceMajor !== POWERPOINT_SOURCE_MAJOR) reject('incompatible-version', 'sourceMajor')
  return {
    schemaMajor: REMOTE_SCHEMA_MAJOR,
    sourceKind: POWERPOINT_SOURCE_KIND,
    sourceMajor: POWERPOINT_SOURCE_MAJOR,
    observedAtMs: expectNonNegative(record, 'observedAtMs', ''),
  }
}

function parseSessionOrdering(record: UnknownRecord) {
  const sessionId = record.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) reject('invalid-field', 'sessionId')
  return {
    sessionId,
    epoch: expectInteger(record, 'epoch', '', 1),
    sequence: expectInteger(record, 'sequence', '', 1),
    observationAgeMs: expectNonNegative(record, 'observationAgeMs', ''),
  }
}

/** Strict parser for the main → sidecar candidate (no session/ordering fields). */
export function parseRemoteSnapshotCandidateV1(input: unknown): ParseResult<RemoteSnapshotCandidateV1> {
  return runParser(() => {
    const record = expectRecord(input, '', CANDIDATE_KEYS)
    return { ...parseHeader(record), ...parseSourceBody(record) }
  })
}

/** Strict parser for the sidecar → `publishPresentationSnapshot` request (no server-owned fields). */
export function parsePublishSnapshotRequestV1(input: unknown): ParseResult<PublishSnapshotRequestV1> {
  return runParser(() => {
    const record = expectRecord(input, '', REQUEST_KEYS)
    const header = parseHeader(record)
    const ordering = parseSessionOrdering(record)
    const sentAtEstimatedServerMs = expectNonNegative(record, 'sentAtEstimatedServerMs', '')
    return { ...header, ...ordering, sentAtEstimatedServerMs, ...parseSourceBody(record) }
  })
}

/** Strict parser for the server-stored snapshot read by every viewer transport. */
export function parseRemoteSnapshotV1(input: unknown): ParseResult<RemoteSnapshotV1> {
  return runParser(() => {
    const record = expectRecord(input, '', SNAPSHOT_KEYS)
    const header = parseHeader(record)
    const ordering = parseSessionOrdering(record)
    const preCommitTransitMs = expectNonNegative(record, 'preCommitTransitMs', '')
    const publishedAtMs = expectNonNegative(record, 'publishedAtMs', '')
    const heartbeatIntervalMs = expectInteger(record, 'heartbeatIntervalMs', '', 1)
    const staleAfterMs = expectInteger(record, 'staleAfterMs', '', 1)
    const disconnectAfterMs = expectInteger(record, 'disconnectAfterMs', '', 1)
    if (heartbeatIntervalMs >= staleAfterMs) reject('invalid-combination', 'heartbeatIntervalMs')
    if (disconnectAfterMs <= staleAfterMs) reject('invalid-combination', 'disconnectAfterMs')
    if (preCommitTransitMs > staleAfterMs) reject('invalid-combination', 'preCommitTransitMs')
    return {
      ...header,
      ...ordering,
      preCommitTransitMs,
      publishedAtMs,
      heartbeatIntervalMs,
      staleAfterMs,
      disconnectAfterMs,
      ...parseSourceBody(record),
    }
  })
}
