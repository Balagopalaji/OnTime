import { compareSnapshotOrder } from './ordering'
import { parseRemoteSnapshotV1 } from './parse-snapshot'
import type {
  PowerPointPresentationPayloadV1,
  PowerPointUnavailablePayloadV1,
  RemoteAvailability,
  RemoteSnapshotV1,
} from './snapshot-types'
import { computeAdvanceMs, computeObservationAgeAtMs, interpolateRow, type RemoteVideoRowView } from './timing'

/**
 * Transport-neutral viewer reducer (cloud listener and later LAN socket feed
 * the same events). Ordering lives in the reducer; freshness and
 * interpolation are a pure projection at an estimated server time, so the
 * reducer owns no timers.
 */

export type ViewerSessionEvent =
  | { type: 'snapshot'; data: unknown }
  | { type: 'session-ended' }
  | { type: 'access-ended' }

export type ViewerSessionOutcome =
  | 'initial'
  | 'applied'
  | 'reset'
  | 'duplicate'
  | 'regression'
  | 'wrong-session'
  | 'invalid'
  | 'incompatible'
  | 'ended'
  | 'access-ended'
  | 'ignored'

export type ViewerSessionState = {
  sessionId: string
  phase: 'receiving' | 'ended' | 'access-ended' | 'incompatible'
  snapshot: RemoteSnapshotV1 | null
  last: { epoch: number; sequence: number } | null
  lastOutcome: ViewerSessionOutcome
}

export type PresentationPayloadView = Omit<PowerPointPresentationPayloadV1, 'videos'> & {
  videos: RemoteVideoRowView[]
}

export type ViewerProjection =
  | { connection: 'connecting' | 'ended' | 'access-ended' | 'incompatible' }
  | {
      connection: 'live' | 'stale' | 'disconnected'
      availability: RemoteAvailability
      payload: PresentationPayloadView | PowerPointUnavailablePayloadV1 | null
    }

export function createViewerSession(sessionId: string): ViewerSessionState {
  return { sessionId, phase: 'receiving', snapshot: null, last: null, lastOutcome: 'initial' }
}

function isTerminal(state: ViewerSessionState): boolean {
  return state.phase === 'ended' || state.phase === 'access-ended'
}

function reduceSnapshot(state: ViewerSessionState, data: unknown): ViewerSessionState {
  const parsed = parseRemoteSnapshotV1(data)
  if (!parsed.ok) {
    const { code } = parsed.error
    if (code === 'incompatible-version' || code === 'unsupported-source') {
      return { ...state, phase: 'incompatible', snapshot: null, lastOutcome: 'incompatible' }
    }
    return { ...state, lastOutcome: 'invalid' }
  }
  const snapshot = parsed.value
  if (snapshot.sessionId !== state.sessionId) return { ...state, lastOutcome: 'wrong-session' }

  const order = compareSnapshotOrder(state.last, snapshot)
  if (order === 'duplicate' || order === 'regression') return { ...state, lastOutcome: order }
  return {
    ...state,
    phase: 'receiving',
    snapshot,
    last: { epoch: snapshot.epoch, sequence: snapshot.sequence },
    lastOutcome: order === 'reset' ? 'reset' : 'applied',
  }
}

export function reduceViewerSession(state: ViewerSessionState, event: ViewerSessionEvent): ViewerSessionState {
  if (isTerminal(state)) return { ...state, lastOutcome: 'ignored' }
  switch (event.type) {
    case 'snapshot':
      return reduceSnapshot(state, event.data)
    case 'session-ended':
      return { ...state, phase: 'ended', snapshot: null, lastOutcome: 'ended' }
    case 'access-ended':
      return { ...state, phase: 'access-ended', snapshot: null, lastOutcome: 'access-ended' }
  }
}

function connectionAt(snapshot: RemoteSnapshotV1, estimatedServerNowMs: number): 'live' | 'stale' | 'disconnected' {
  const ageMs = computeObservationAgeAtMs(snapshot, estimatedServerNowMs)
  if (ageMs >= snapshot.disconnectAfterMs) return 'disconnected'
  return ageMs >= snapshot.staleAfterMs ? 'stale' : 'live'
}

/** Freshness state and interpolated rows at an estimated server instant. */
export function projectViewerSession(state: ViewerSessionState, estimatedServerNowMs: number): ViewerProjection {
  if (state.phase !== 'receiving') return { connection: state.phase }
  const { snapshot } = state
  if (snapshot === null) return { connection: 'connecting' }

  const connection = connectionAt(snapshot, estimatedServerNowMs)
  if (snapshot.availability !== 'active') {
    return { connection, availability: snapshot.availability, payload: snapshot.payload }
  }
  const advanceMs = computeAdvanceMs(snapshot, estimatedServerNowMs)
  return {
    connection,
    availability: snapshot.availability,
    payload: { ...snapshot.payload, videos: snapshot.payload.videos.map((row) => interpolateRow(row, advanceMs)) },
  }
}
