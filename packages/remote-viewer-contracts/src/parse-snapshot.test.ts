import { describe, expect, it } from 'vitest'
import {
  FORBIDDEN_ENVELOPE_FIELDS,
  FORBIDDEN_HEADLINE_FIELDS,
  FORBIDDEN_PAYLOAD_FIELDS,
  FORBIDDEN_ROW_FIELDS,
  activeCandidate,
  activeRequest,
  activeSnapshot,
  playingRow,
  presentationPayload,
  readyRow,
  type Json,
} from '../test/fixtures'
import {
  parsePublishSnapshotRequestV1,
  parseRemoteSnapshotCandidateV1,
  parseRemoteSnapshotV1,
} from './parse-snapshot'
import type { ParseError, ParseResult } from './snapshot-types'

type Parser = (input: unknown) => ParseResult<unknown>

const parsers: Array<[string, Parser, () => Json]> = [
  ['candidate', parseRemoteSnapshotCandidateV1, activeCandidate],
  ['publish request', parsePublishSnapshotRequestV1, activeRequest],
  ['stored snapshot', parseRemoteSnapshotV1, activeSnapshot],
]

function errorOf(result: ParseResult<unknown>): ParseError {
  if (result.ok) throw new Error(`expected rejection, got ${JSON.stringify(result.value)}`)
  return result.error
}

function valueOf<T>(result: ParseResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`)
  return result.value
}

function withPayload(build: () => Json, payload: unknown, availability = 'active'): Json {
  return { ...build(), availability, payload }
}

describe.each(parsers)('%s parser', (_name, parse, build) => {
  it('reconstructs a valid active input into an equal, unaliased object', () => {
    // Defect: the parser forwards (aliases) its input so later mutation leaks through.
    const input = build()
    const output = valueOf(parse(input)) as Json
    expect(output).toEqual(input)
    expect(output).not.toBe(input)
    const payload = input.payload as Json
    const outPayload = output.payload as Json
    expect(outPayload).not.toBe(payload)
    expect(outPayload.videos).not.toBe(payload.videos)
    ;(payload.videos as Json[])[0].label = 'mutated'
    ;(payload.headline as Json).focusedOrdinal = 1
    expect(((outPayload.videos as Json[])[0] as Json).label).toBe('Walk-in loop')
    expect((outPayload.headline as Json).focusedOrdinal).toBe(0)
  })

  it.each(Object.keys(FORBIDDEN_ENVELOPE_FIELDS))('rejects forbidden envelope field %s', (key) => {
    // Defect: helper diagnostics, geometry, or credentials are forwarded to viewers.
    const input = { ...build(), [key]: FORBIDDEN_ENVELOPE_FIELDS[key] }
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: key })
  })

  it.each(Object.keys(FORBIDDEN_PAYLOAD_FIELDS))('rejects forbidden payload field %s', (key) => {
    const input = withPayload(build, presentationPayload({ [key]: FORBIDDEN_PAYLOAD_FIELDS[key] }))
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: `payload.${key}` })
  })

  it.each(Object.keys(FORBIDDEN_HEADLINE_FIELDS))('rejects forbidden headline field %s', (key) => {
    const headline = { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining', [key]: FORBIDDEN_HEADLINE_FIELDS[key] }
    const input = withPayload(build, presentationPayload({ headline }))
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: `payload.headline.${key}` })
  })

  it.each(Object.keys(FORBIDDEN_ROW_FIELDS))('rejects forbidden video row field %s', (key) => {
    const videos = [playingRow(), readyRow({ [key]: FORBIDDEN_ROW_FIELDS[key] })]
    const input = withPayload(build, presentationPayload({ videos }))
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: `payload.videos.1.${key}` })
  })

  it('rejects an inherited-prototype key smuggled through JSON', () => {
    // Defect: `__proto__` bypasses an own-key allowlist check.
    const input = JSON.parse(JSON.stringify(build()).replace('{', '{"__proto__":{"isAdmin":true},'))
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: '__proto__' })
  })

  it('sanitizes path-shaped titles and labels instead of forwarding them', () => {
    // Defect: the server or viewer trusts upstream sanitization and forwards a deck path.
    const input = withPayload(
      build,
      presentationPayload({
        displayTitle: '\\\\fileserver\\media\\Sunday Service.pptx',
        videos: [playingRow({ label: 'C:\\Media\\Walk-in.mp4' }), readyRow({ label: '\u0000' })],
      }),
    )
    const payload = (valueOf(parse(input)) as Json).payload as Json
    expect(payload.displayTitle).toBe('Sunday Service')
    const [first, second] = payload.videos as Json[]
    expect(first.label).toBe('Walk-in')
    expect('label' in second).toBe(false)
  })

  it.each([
    [{ schemaMajor: 2 }, 'incompatible-version', 'schemaMajor'],
    [{ sourceMajor: 2 }, 'incompatible-version', 'sourceMajor'],
    [{ sourceKind: 'stage-timer' }, 'unsupported-source', 'sourceKind'],
  ])('rejects %j as %s', (override, code, path) => {
    // Defect: an unknown source or future major is rendered as if it were PowerPoint v1.
    expect(errorOf(parse({ ...build(), ...override }))).toEqual({ code, path })
  })

  it.each([
    ['connecting with a payload', 'connecting', presentationPayload(), 'payload'],
    ['active without a payload', 'active', null, 'payload'],
    ['active with an unavailable reason', 'active', { reason: 'no-slideshow' }, 'payload.reason'],
    ['unavailable with a presentation payload', 'source-unavailable', presentationPayload(), 'payload.reason'],
    ['unavailable without a payload', 'source-unavailable', null, 'payload'],
  ])('rejects %s', (_label, availability, payload, path) => {
    // Defect: contradictory availability/payload pairs render stale timing as live.
    expect(errorOf(parse(withPayload(build, payload, availability)))).toEqual({ code: 'invalid-combination', path })
  })

  it('rejects a non-plain unavailable payload before reading its getters', () => {
    // Defect: a class instance or proxy runs getters before shape validation.
    let touched = false
    const payload = Object.create({ get reason() { touched = true; return 'no-slideshow' } })
    expect(errorOf(parse(withPayload(build, payload, 'source-unavailable')))).toEqual({ code: 'invalid-shape', path: 'payload' })
    expect(touched).toBe(false)
  })

  it('reports unknown keys before invalid values on an unavailable payload', () => {
    const input = withPayload(build, { reason: 'bogus', extra: 1 }, 'source-unavailable')
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: 'payload.extra' })
  })

  it('rejects slide/timing fields on an unavailable payload', () => {
    const input = withPayload(build, { reason: 'no-slideshow', slideNumber: 3, videos: [] }, 'source-unavailable')
    expect(errorOf(parse(input))).toEqual({ code: 'unknown-key', path: 'payload.slideNumber' })
  })

  it.each(['no-presentation', 'no-slideshow', 'helper-unavailable'])('accepts unavailable reason %s', (reason) => {
    const input = withPayload(build, { reason }, 'source-unavailable')
    expect((valueOf(parse(input)) as Json).payload).toEqual({ reason })
  })

  it('accepts connecting with a null payload', () => {
    const input = withPayload(build, null, 'connecting')
    expect((valueOf(parse(input)) as Json).payload).toBeNull()
  })

  it.each([
    ['availability', 'paused', 'invalid-field'],
    ['observedAtMs', -1, 'invalid-field'],
    ['observedAtMs', Number.NaN, 'invalid-field'],
    ['observedAtMs', '1790000000000', 'invalid-field'],
  ])('rejects envelope %s = %j', (key, value, code) => {
    expect(errorOf(parse({ ...build(), [key]: value }))).toEqual({ code, path: key })
  })

  it.each([
    ['a missing header field', 'schemaMajor'],
    ['a missing observation instant', 'observedAtMs'],
  ])('rejects %s', (_label, key) => {
    const input = build()
    delete input[key]
    expect(errorOf(parse(input)).path).toBe(key)
  })

  it.each([null, [], 'snapshot', 42])('rejects non-object input %j', (input) => {
    expect(errorOf(parse(input))).toEqual({ code: 'invalid-shape', path: '' })
  })
})

describe('PowerPoint presentation payload invariants', () => {
  const parse = (payload: Json) => parseRemoteSnapshotCandidateV1(activeCandidate({ payload }))

  it.each([
    ['durationMs', null],
    ['elapsedMsAtObservation', null],
    ['remainingMsAtObservation', null],
    ['remainingMsAtObservation', -5],
    ['elapsedMsAtObservation', Number.POSITIVE_INFINITY],
  ])('rejects a playing row with %s = %j', (key, value) => {
    // Defect: nullable or negative playing timing makes interpolation non-total.
    const payload = presentationPayload({ videos: [playingRow({ [key]: value })] })
    const error = errorOf(parse(payload))
    expect(error.path).toBe(`payload.videos.0.${key}`)
    expect(['invalid-field', 'invalid-combination']).toContain(error.code)
  })

  it.each([
    ['status', 'stopped'],
    ['ordinal', -1],
    ['ordinal', 1.5],
    ['isFocus', 'yes'],
    ['label', 42],
    ['durationMs', '120000'],
  ])('rejects a row with invalid %s = %j', (key, value) => {
    const payload = presentationPayload({ videos: [playingRow({ [key]: value })] })
    expect(errorOf(parse(payload))).toEqual({ code: 'invalid-field', path: `payload.videos.0.${key}` })
  })

  it('accepts paused and ended rows whose unmeasured scalars are null', () => {
    const videos = [
      playingRow({ status: 'paused', elapsedMsAtObservation: 10_000, remainingMsAtObservation: null }),
      readyRow({ status: 'ended', ordinal: 1, durationMs: null }),
    ]
    const payload = presentationPayload({ presentationState: 'paused', videos })
    expect((valueOf(parse(payload)).payload as Json).videos).toEqual(videos)
  })

  it('requires every numeric row field to be null when timing is unavailable', () => {
    // Defect: a timing-unavailable slide still publishes a countdown.
    const measured = presentationPayload({ presentationState: 'timing-unavailable', videos: [readyRow({ ordinal: 0 })] })
    expect(errorOf(parse(measured))).toEqual({ code: 'invalid-combination', path: 'payload.videos.0.durationMs' })

    const unmeasured = presentationPayload({
      presentationState: 'timing-unavailable',
      headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [readyRow({ ordinal: 0, durationMs: null })],
    })
    expect(valueOf(parse(unmeasured)).payload).toEqual(unmeasured)

    // Host timing_unavailable keeps a playing video's identity but not its timing.
    const playingIdentity = presentationPayload({
      presentationState: 'timing-unavailable',
      videos: [playingRow({ durationMs: null, elapsedMsAtObservation: null, remainingMsAtObservation: null })],
    })
    expect(valueOf(parse(playingIdentity)).payload).toEqual(playingIdentity)
  })

  it('requires an empty row list for no-video and rows for known video states', () => {
    const noVideoWithRows = presentationPayload({ presentationState: 'no-video' })
    expect(errorOf(parse(noVideoWithRows))).toEqual({ code: 'invalid-combination', path: 'payload.videos' })

    const playingWithoutRows = presentationPayload({
      headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [],
    })
    expect(errorOf(parse(playingWithoutRows))).toEqual({ code: 'invalid-combination', path: 'payload.videos' })

    const noVideo = presentationPayload({
      presentationState: 'no-video',
      headline: { focusedOrdinal: null, mode: 'latest-started', timingMode: 'elapsed' },
      videos: [],
    })
    expect(valueOf(parse(noVideo)).payload).toEqual(noVideo)
  })

  it('requires the headline focus to be the single host-marked focus row', () => {
    // Defect: viewers must reselect a headline because focus and rows disagree.
    const mismatch = presentationPayload({ headline: { focusedOrdinal: 1, mode: 'longest-remaining', timingMode: 'remaining' } })
    expect(errorOf(parse(mismatch))).toEqual({ code: 'invalid-combination', path: 'payload.headline.focusedOrdinal' })

    const twoFocus = presentationPayload({ videos: [playingRow(), readyRow({ isFocus: true })] })
    expect(errorOf(parse(twoFocus))).toEqual({ code: 'invalid-combination', path: 'payload.videos.1.isFocus' })

    const orphanFocus = presentationPayload({ headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' } })
    expect(errorOf(parse(orphanFocus))).toEqual({ code: 'invalid-combination', path: 'payload.headline.focusedOrdinal' })
  })

  it.each([
    // Defect: an aggregate state says to tick while no row can, or a row ticks under a static state.
    ['playing', [readyRow({ ordinal: 0, isFocus: true })]],
    ['ready', [playingRow()]],
    ['paused', [playingRow()]],
    ['ended', [playingRow()]],
  ])('rejects presentationState %s contradicting row playback', (presentationState, videos) => {
    const payload = presentationPayload({ presentationState, videos })
    expect(errorOf(parse(payload))).toEqual({ code: 'invalid-combination', path: 'payload.presentationState' })
  })

  it('rejects a sparse videos array instead of compacting it', () => {
    // Defect: an in-process producer bug silently drops a row.
    // eslint-disable-next-line no-sparse-arrays
    const videos = [playingRow(), , readyRow({ ordinal: 2 })]
    expect(errorOf(parse(presentationPayload({ videos })))).toEqual({ code: 'invalid-shape', path: 'payload.videos.1' })
  })

  it('normalizes negative zero so reconstructed values encode identically', () => {
    // Defect: -0 survives and diverges under Object.is / Firestore integer-vs-double encoding.
    const videos = [playingRow({ ordinal: -0, elapsedMsAtObservation: -0 }), readyRow()]
    const row = (valueOf(parse(presentationPayload({ videos }))).payload as Json).videos as Json[]
    expect(Object.is(row[0].ordinal, 0)).toBe(true)
    expect(Object.is(row[0].elapsedMsAtObservation, 0)).toBe(true)
  })

  it('requires strictly increasing unique ordinals in host tile order', () => {
    const videos = [playingRow({ ordinal: 1 }), readyRow({ ordinal: 1 })]
    const payload = presentationPayload({ headline: { focusedOrdinal: 1, mode: 'longest-remaining', timingMode: 'remaining' }, videos })
    expect(errorOf(parse(payload))).toEqual({ code: 'invalid-combination', path: 'payload.videos.1.ordinal' })
  })

  it.each([
    ['slideNumber', 0],
    ['slideCount', 2.5],
    ['presentationState', 'stopped'],
    ['headline', { focusedOrdinal: 0, mode: 'first', timingMode: 'remaining' }],
    ['videos', 'none'],
  ])('rejects payload %s = %j', (key, value) => {
    const error = errorOf(parse(presentationPayload({ [key]: value })))
    expect(error.code).toBe('invalid-field')
    expect(error.path.startsWith(`payload.${key}`)).toBe(true)
  })

  it('rejects a slide number beyond the slide count', () => {
    expect(errorOf(parse(presentationPayload({ slideNumber: 13 })))).toEqual({
      code: 'invalid-combination',
      path: 'payload.slideNumber',
    })
  })

  it('accepts null slide identity and an omitted title', () => {
    const payload = presentationPayload({ slideNumber: null, slideCount: null })
    delete payload.displayTitle
    expect(valueOf(parse(payload)).payload).toEqual(payload)
  })
})

describe('publish request fields', () => {
  it.each([
    ['sessionId', 'rooms/abc/timers', 'invalid-field'],
    ['sessionId', '', 'invalid-field'],
    ['epoch', 0, 'invalid-field'],
    ['sequence', 1.5, 'invalid-field'],
    ['observationAgeMs', -1, 'invalid-field'],
    ['sentAtEstimatedServerMs', Number.NaN, 'invalid-field'],
  ])('rejects %s = %j', (key, value, code) => {
    // Defect: path-injecting session IDs or non-monotonic counters reach the transaction.
    expect(errorOf(parsePublishSnapshotRequestV1(activeRequest({ [key]: value })))).toEqual({ code, path: key })
  })

  it('accepts a null send estimate when the sidecar has no reliable offset', () => {
    const parsed = parsePublishSnapshotRequestV1(activeRequest({ sentAtEstimatedServerMs: null }))
    expect(valueOf(parsed).sentAtEstimatedServerMs).toBeNull()
  })

  it('rejects server-owned fields supplied by the sidecar', () => {
    // Defect: a sidecar forges server time or freshness policy.
    for (const key of ['publishedAtMs', 'preCommitTransitMs', 'staleAfterMs']) {
      expect(errorOf(parsePublishSnapshotRequestV1(activeRequest({ [key]: 1 })))).toEqual({ code: 'unknown-key', path: key })
    }
  })
})

describe('candidate fields', () => {
  it('rejects session/ordering fields that only the sidecar may add', () => {
    // Defect: main forwards publisher state across the process boundary.
    for (const key of ['sessionId', 'epoch', 'sequence', 'observationAgeMs']) {
      expect(errorOf(parseRemoteSnapshotCandidateV1(activeCandidate({ [key]: 1 })))).toEqual({ code: 'unknown-key', path: key })
    }
  })
})

describe('stored snapshot freshness policy', () => {
  it('accepts a policy tightened below the v1 defaults', () => {
    const parsed = parseRemoteSnapshotV1(activeSnapshot({ heartbeatIntervalMs: 5_000, staleAfterMs: 15_000, disconnectAfterMs: 40_000 }))
    expect(valueOf(parsed).staleAfterMs).toBe(15_000)
  })

  it.each([
    [{ staleAfterMs: 0 }, 'staleAfterMs'],
    [{ heartbeatIntervalMs: 30_000 }, 'heartbeatIntervalMs'],
    [{ disconnectAfterMs: 20_000 }, 'disconnectAfterMs'],
    [{ preCommitTransitMs: 25_001 }, 'preCommitTransitMs'],
    [{ publishedAtMs: -1 }, 'publishedAtMs'],
    // Defect: an inflated server policy means the viewer never goes stale.
    [{ staleAfterMs: 1e12, disconnectAfterMs: 2e12 }, 'staleAfterMs'],
    [{ disconnectAfterMs: 60_001 }, 'disconnectAfterMs'],
    [{ heartbeatIntervalMs: 10_001 }, 'heartbeatIntervalMs'],
  ])('rejects %j', (override, path) => {
    // Defect: a policy where stale precedes heartbeat, or unbounded transit, breaks freshness.
    const error = errorOf(parseRemoteSnapshotV1(activeSnapshot(override)))
    expect(error.path).toBe(path)
    expect(['invalid-field', 'invalid-combination']).toContain(error.code)
  })
})
