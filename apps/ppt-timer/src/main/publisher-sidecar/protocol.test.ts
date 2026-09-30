import { describe, expect, it } from 'vitest'
import {
  SIDECAR_MAX_MESSAGE_BYTES,
  SIDECAR_PROTOCOL_MAJOR,
  parseHello,
  parseMainToSidecar,
  parseSidecarToMain,
} from './protocol'

const NONCE = 'n'.repeat(32)
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
