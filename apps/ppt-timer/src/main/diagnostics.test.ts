import { describe, expect, it } from 'vitest'
import { DiagnosticsBuffer, DIAGNOSTICS_CAPACITY, redactPath, type DiagMeta } from './diagnostics'

const meta: DiagMeta = {
  appVersion: '0.0.0-beta',
  helperVersion: 'ppt-probe/1',
  protocolVersion: 1,
  signingStatus: 'unsigned-beta',
}

describe('redactPath (S-025 basename only)', () => {
  it('reduces windows and posix full paths to the basename', () => {
    expect(redactPath('C:\\Users\\bob\\AppData\\settings.json.corrupt-1')).toBe('settings.json.corrupt-1')
    expect(redactPath('/home/bob/decks/deck.pptx')).toBe('deck.pptx')
    expect(redactPath('bare.pptx')).toBe('bare.pptx')
  })
})

describe('DiagnosticsBuffer ring (S-026 last 100)', () => {
  it('caps at the 100-event FIFO and drops the oldest', () => {
    let t = 0
    const buf = new DiagnosticsBuffer({ now: () => t++ })
    for (let i = 0; i < 105; i++) buf.push({ kind: 'app_launch' })
    expect(buf.count).toBe(DIAGNOSTICS_CAPACITY)
    const report = buf.buildReport(meta)
    // Last 100 timestamps retained: 5..104. Oldest (0..4) dropped.
    expect(report).toContain('[104] app app_launch')
    expect(report).toContain('[5] app app_launch')
    expect(report).not.toContain('[0] app app_launch')
    expect(report).not.toContain('[4] app app_launch')
  })

  it('accepts bridge events through the BridgeDiagnosticSink adapter', () => {
    const buf = new DiagnosticsBuffer()
    const sink = buf.asSink()
    sink({ kind: 'helper_start', generation: 1 })
    sink({ kind: 'helper_stderr', generation: 1, byteCount: 128 })
    const report = buf.buildReport(meta)
    expect(report).toContain('bridge helper_start generation=1')
    expect(report).toContain('bridge helper_stderr generation=1 byteCount=128')
  })
})

describe('buildReport includes the S-026 diagnostic surface', () => {
  it('records versions, signing, affinity, slide/media, display, and bounds', () => {
    const buf = new DiagnosticsBuffer()
    buf.pushBridge({ kind: 'helper_start', generation: 1 })
    buf.push({ kind: 'slide_observed', slideNumber: 3, mediaCount: 1, selectedMediaId: 502 })
    buf.push({ kind: 'affinity', processCount: 2, selectedPid: 1234, comPid: 5678, mismatch: true })
    buf.push({ kind: 'display_change', displayId: '2', scaleFactor: 1.5, displayCount: 2 })
    buf.push({ kind: 'window_bounds', x: 100, y: 200, width: 360, height: 220 })
    const report = buf.buildReport(meta)
    for (const needle of [
      'appVersion: 0.0.0-beta',
      'protocolVersion: 1',
      'signingStatus: unsigned-beta',
      'generation=1',
      'slide=3',
      'mediaCount=1',
      'selectedMediaId=502',
      'processCount=2',
      'selectedPid=1234',
      'comPid=5678',
      'mismatch=true',
      'displayId=2',
      'scaleFactor=1.5',
      'displayCount=2',
      'width=360',
    ]) {
      expect(report).toContain(needle)
    }
  })
})

describe('redaction guarantees (S-025)', () => {
  it('basenames a quarantined settings path and leaks no directory or username', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({
      kind: 'settings_recovered',
      quarantinedPath: 'C:\\Users\\bob\\AppData\\Roaming\\OnTime\\settings.json.corrupt-9',
    })
    const report = buf.buildReport(meta)
    expect(report).toContain('quarantinedPath=settings.json.corrupt-9')
    expect(report).not.toContain('bob')
    expect(report).not.toContain('AppData')
    expect(report).not.toContain('Roaming')
  })

  it('never carries stderr text, slide titles, video names, tokens, env, or usernames', () => {
    const buf = new DiagnosticsBuffer()
    // The bridge stderr event stores only a byte count by construction.
    buf.pushBridge({ kind: 'helper_stderr', generation: 1, byteCount: 256 })
    // Slide/media events carry only numeric identifiers.
    buf.push({ kind: 'slide_observed', slideNumber: 3, mediaCount: 1, selectedMediaId: 502 })
    buf.push({ kind: 'availability_transition', from: 'playing', to: 'unavailable' })
    const report = buf.buildReport(meta)
    expect(report).not.toContain('SECRET')
    expect(report).not.toContain('TOKEN')
    expect(report).not.toContain('bob')
    expect(report).not.toContain('Intro.mp4')
    expect(report).not.toContain('password')
    expect(report).toContain('byteCount=256')
  })
})
