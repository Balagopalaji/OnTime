import { describe, expect, it } from 'vitest'
import {
  SIDECAR_MAX_MESSAGE_BYTES,
  SIDECAR_PROTOCOL_MAJOR,
  parseHello,
  parseMainToSidecar,
  parseSidecarToMain,
} from './protocol'

const NONCE = 'n'.repeat(32)
const VIEWER = 'https://ontime.app/session/s1/view#token=' + 't'.repeat(43)
const candidate = { schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, observedAtMs: 1_000, availability: 'connecting', payload: null }

describe('sidecar protocol', () => {
  it('accepts HELLO only with the supported major, a well-formed nonce, and known capabilities', () => {
    const hello = { kind: 'HELLO', nonce: NONCE, protocolMajor: SIDECAR_PROTOCOL_MAJOR, maxMessageBytes: SIDECAR_MAX_MESSAGE_BYTES, capabilities: ['publish'] }
    expect(parseHello(hello)).toEqual({ ok: true, value: hello })
    expect(parseHello({ ...hello, protocolMajor: 2 })).toEqual({ ok: false, error: 'incompatible-major' })
    expect(parseHello({ ...hello, nonce: 'short' })).toEqual({ ok: false, error: 'invalid-field' })
    expect(parseHello({ ...hello, extra: 1 })).toEqual({ ok: false, error: 'unknown-key' })
    expect(parseHello({ ...hello, kind: 'SHARE_START' })).toEqual({ ok: false, error: 'unknown-kind' })
  })

  it.each([
    [{ kind: 'SHARE_START', nonce: NONCE, id: 1 }],
    [{ kind: 'SHARE_STOP', nonce: NONCE, id: 2 }],
    [{ kind: 'SIGN_OUT', nonce: NONCE, id: 9 }],
    [{ kind: 'END_SESSION', nonce: NONCE, id: 3 }],
    [{ kind: 'SHUTDOWN', nonce: NONCE, id: 4, deadlineMs: 2_000 }],
  ])('reconstructs main→sidecar %j', (message) => {
    const result = parseMainToSidecar(message, NONCE)
    expect(result).toEqual({ ok: true, value: message })
    if (result.ok) expect(result.value).not.toBe(message)
  })

  it('re-validates snapshot candidates through the strict contract (no raw HostView across the port)', () => {
    // Defect: main forwards host internals (paths, IDs, diagnostics) inside a candidate.
    expect(parseMainToSidecar({ kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 5, candidate }, NONCE)).toEqual({
      ok: true,
      value: { kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 5, candidate },
    })
    expect(parseMainToSidecar({ kind: 'SNAPSHOT_CANDIDATE', nonce: NONCE, id: 5, candidate: { ...candidate, instanceId: 4 } }, NONCE)).toEqual({
      ok: false,
      error: 'invalid-field',
    })
  })

  it.each([
    [{ kind: 'SHARE_START', nonce: 'm'.repeat(32), id: 1 }, 'wrong-nonce'],
    [{ kind: 'OPEN_PRESENTATION', nonce: NONCE, id: 1 }, 'unknown-kind'],
    [{ kind: 'NEXT_SLIDE', nonce: NONCE, id: 1 }, 'unknown-kind'],
    [{ kind: 'SHARE_START', nonce: NONCE, id: 1, path: 'C:\\deck.pptx' }, 'unknown-key'],
    [{ kind: 'SHARE_START', nonce: NONCE, id: -1 }, 'invalid-field'],
    [{ kind: 'SHUTDOWN', nonce: NONCE, id: 1, deadlineMs: 0 }, 'invalid-field'],
    [{ kind: 'SHARE_START', nonce: NONCE, id: 1, padding: 'x'.repeat(SIDECAR_MAX_MESSAGE_BYTES) }, 'oversize'],
    [null, 'invalid-shape'],
    ['SHARE_START', 'invalid-shape'],
  ])('rejects main→sidecar %j as %s', (message, error) => {
    // Defect: the sidecar accepts control or oversized/forged messages (RPV-010: no PowerPoint control).
    expect(parseMainToSidecar(message, NONCE)).toEqual({ ok: false, error })
  })

  it.each([
    [{ kind: 'READY', nonce: NONCE, protocolMajor: 1, capabilities: ['publish'] }],
    [{ kind: 'ACK', nonce: NONCE, id: 7 }],
    [{ kind: 'NACK', nonce: NONCE, id: 7, code: 'not-sharing' }],
    [{ kind: 'SHARE_STATE', nonce: NONCE, state: 'sharing' }],
    [{ kind: 'SAFE_ERROR', nonce: NONCE, code: 'internal' }],
    [{ kind: 'SHUTDOWN_COMPLETE', nonce: NONCE }],
  ])('reconstructs sidecar→main %j', (message) => {
    expect(parseSidecarToMain(message, NONCE)).toEqual({ ok: true, value: message })
  })

  it.each([
    [{ kind: 'AUTH_CALLBACK', nonce: NONCE, id: 8, challengeId: 'c'.repeat(32), code: 'k'.repeat(43) }],
    [{ kind: 'SEAL_RESULT', nonce: NONCE, requestId: 3, ok: true }],
    [{ kind: 'SEAL_RESULT', nonce: NONCE, requestId: 3, ok: false, error: 'encryption-unavailable' }],
    [{ kind: 'UNSEAL_RESULT', nonce: NONCE, requestId: 4, ok: true, data: '{"v":1}' }],
    [{ kind: 'UNSEAL_RESULT', nonce: NONCE, requestId: 4, ok: false, error: 'not-found' }],
    [{ kind: 'CLEAR_RESULT', nonce: NONCE, requestId: 5, ok: true }],
  ])('reconstructs storage/auth main→sidecar %j', (message) => {
    expect(parseMainToSidecar(message, NONCE)).toEqual({ ok: true, value: message })
  })

  it.each([
    [{ kind: 'AUTH_REQUIRED', nonce: NONCE, url: 'https://ontime.app/publisher/device/approve?challenge=' + 'c'.repeat(32) }],
    [{ kind: 'SEAL_REQUEST', nonce: NONCE, requestId: 1, data: '{"v":1}' }],
    [{ kind: 'UNSEAL_REQUEST', nonce: NONCE, requestId: 2 }],
    [{ kind: 'CLEAR_SEALED', nonce: NONCE, requestId: 3 }],
    [{ kind: 'PUBLISH_STATUS', nonce: NONCE, status: 'live' }],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: VIEWER }],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: 'http://localhost:5173/session/s1/view#token=' + 't'.repeat(32) }],
  ])('reconstructs storage/auth/share sidecar→main %j', (message) => {
    expect(parseSidecarToMain(message, NONCE)).toEqual({ ok: true, value: message })
  })

  it.each([
    [{ kind: 'SEAL_RESULT', nonce: NONCE, requestId: 3, ok: true, data: 'leak' }, 'unknown-key'],
    [{ kind: 'UNSEAL_RESULT', nonce: NONCE, requestId: 4, ok: true }, 'invalid-field'],
    [{ kind: 'UNSEAL_RESULT', nonce: NONCE, requestId: 4, ok: false, error: 'Error: C:\\Users\\x' }, 'invalid-field'],
    [{ kind: 'AUTH_CALLBACK', nonce: NONCE, id: 1, challengeId: 'short', code: 'k'.repeat(43) }, 'invalid-field'],
  ])('rejects malformed storage/auth main→sidecar %j as %s', (message, error) => {
    expect(parseMainToSidecar(message, NONCE)).toEqual({ ok: false, error })
  })

  it.each([
    [{ kind: 'AUTH_REQUIRED', nonce: NONCE, url: 'javascript:alert(1)' }, 'invalid-field'],
    [{ kind: 'AUTH_REQUIRED', nonce: NONCE, url: 'https://ontime.app/publisher/device/approve?challenge=x&token=secret' }, 'invalid-field'],
    [{ kind: 'SEAL_REQUEST', nonce: NONCE, requestId: 1, data: 'x'.repeat(20_000) }, 'invalid-field'],
    [{ kind: 'PUBLISH_STATUS', nonce: NONCE, status: 'Error: token=abc' }, 'invalid-field'],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: VIEWER.replace('#token=', '?token=') }, 'invalid-field'],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: VIEWER.replace('https:', 'file:') }, 'invalid-field'],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: VIEWER.replace('/view', '/admin') }, 'invalid-field'],
    [{ kind: 'VIEWER_LINK', nonce: NONCE, url: VIEWER + '&refresh=secret' }, 'invalid-field'],
  ])('rejects malformed storage/auth sidecar→main %j as %s', (message, error) => {
    // Defect: the sidecar asks main to open an arbitrary URL or to seal unbounded data.
    expect(parseSidecarToMain(message, NONCE)).toEqual({ ok: false, error })
  })

  it.each([
    [{ kind: 'READY', nonce: NONCE, protocolMajor: 2, capabilities: [] }, 'incompatible-major'],
    [{ kind: 'SAFE_ERROR', nonce: NONCE, code: 'Error: at C:\\Users\\ops\\sidecar.js:12' }, 'invalid-field'],
    [{ kind: 'SHARE_STATE', nonce: NONCE, state: 'publishing-to-evil' }, 'invalid-field'],
    [{ kind: 'RUN_COMMAND', nonce: NONCE, command: 'powerpoint.next' }, 'unknown-kind'],
    [{ kind: 'ACK', nonce: 'x'.repeat(32), id: 1 }, 'wrong-nonce'],
  ])('rejects sidecar→main %j as %s', (message, error) => {
    // Defect: stack traces/paths or unknown commands flow back into main.
    expect(parseSidecarToMain(message, NONCE)).toEqual({ ok: false, error })
  })
})
