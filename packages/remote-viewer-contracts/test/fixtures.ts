/**
 * Plain-JSON fixtures for the RemoteSnapshotV1 parsers. Every builder returns a
 * fresh object so tests may mutate it.
 */

export type Json = Record<string, unknown>

export function playingRow(overrides: Json = {}): Json {
  return {
    ordinal: 0,
    label: 'Walk-in loop',
    status: 'playing',
    durationMs: 120_000,
    elapsedMsAtObservation: 30_000,
    remainingMsAtObservation: 90_000,
    isFocus: true,
    ...overrides,
  }
}

export function readyRow(overrides: Json = {}): Json {
  return {
    ordinal: 1,
    label: 'Sermon bumper',
    status: 'ready',
    durationMs: 45_000,
    elapsedMsAtObservation: null,
    remainingMsAtObservation: null,
    isFocus: false,
    ...overrides,
  }
}

export function presentationPayload(overrides: Json = {}): Json {
  return {
    reason: 'presentation',
    presentationState: 'playing',
    slideNumber: 3,
    slideCount: 12,
    displayTitle: 'Sunday Service',
    headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
    videos: [playingRow(), readyRow()],
    ...overrides,
  }
}

const header = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1 }

export function activeCandidate(overrides: Json = {}): Json {
  return {
    ...header,
    observedAtMs: 1_790_000_000_000,
    availability: 'active',
    payload: presentationPayload(),
    ...overrides,
  }
}

export function activeRequest(overrides: Json = {}): Json {
  return {
    ...activeCandidate(),
    sessionId: 'sess_Abc123',
    epoch: 2,
    sequence: 7,
    observationAgeMs: 40,
    sentAtEstimatedServerMs: 1_790_000_000_100,
    ...overrides,
  }
}

export function activeSnapshot(overrides: Json = {}): Json {
  return {
    ...activeCandidate(),
    sessionId: 'sess_Abc123',
    epoch: 2,
    sequence: 7,
    observationAgeMs: 40,
    preCommitTransitMs: 180,
    publishedAtMs: 1_790_000_000_300,
    heartbeatIntervalMs: 10_000,
    staleAfterMs: 25_000,
    disconnectAfterMs: 60_000,
    ...overrides,
  }
}

/**
 * Forbidden fields from the Deep Plan privacy allowlist, grouped by the level
 * at which a careless adapter could forward them.
 */
export const FORBIDDEN_ENVELOPE_FIELDS: Json = {
  fullName: 'C:\\Shows\\Sunday\\service.pptx',
  deckPath: '\\\\fileserver\\media\\service.pptx',
  instanceId: 4,
  processCount: 2,
  pids: [4120, 5532],
  comAffinity: 'sta-thread-3',
  helperPath: 'C:\\Program Files\\Downstage\\resources\\bin\\ppt-probe.exe',
  protocolVersion: 3,
  product: 'Microsoft PowerPoint 16.0',
  warnings: ['stale-observation'],
  extensions: { debug: true },
  observation: { pollMs: 250 },
  windowBounds: { x: 0, y: 0, width: 320, height: 90 },
  rendererAction: 'toggle-panel',
  idToken: 'eyJhbGciOi.secret',
  refreshToken: 'refresh-secret',
  linkToken: 'viewer-link-secret',
  tokenHash: 'sha256:abcd',
}

export const FORBIDDEN_PAYLOAD_FIELDS: Json = {
  title: 'C:\\Shows\\Sunday\\service.pptx',
  filenameBasename: 'service.pptx',
  selectedVideoId: 88213,
  selectedVideoName: 'C:\\Media\\walk-in.mp4',
  editSlideVideos: [{ id: 5 }],
  timeMs: 90_000,
}

export const FORBIDDEN_ROW_FIELDS: Json = {
  id: 88213,
  name: 'C:\\Media\\walk-in.mp4',
  mediaId: 88213,
  playing: true,
  path: 'C:\\Media\\walk-in.mp4',
}

export const FORBIDDEN_HEADLINE_FIELDS: Json = {
  selectedVideoId: 88213,
  playOrder: { 88213: 1 },
}
