import { describe, expect, it } from 'vitest'
import { AFFINITY_DIAGNOSTICS_CAPACITY, DiagnosticsBuffer, DIAGNOSTICS_CAPACITY, isOverlayDebug, OVERLAY_DEBUG_ENV, redactPath, type DiagMeta } from './diagnostics'

const meta: DiagMeta = {
  appVersion: '0.1.0-beta.1',
  helperVersion: '0.1.0-beta.1',
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
    sink({ kind: 'helper_termination', generation: 1, context: 'generation_failure', result: 'unconfirmed', waitMs: 25 })
    const report = buf.buildReport(meta)
    expect(report).toContain('bridge helper_start generation=1')
    expect(report).toContain('bridge helper_stderr generation=1 byteCount=128')
    expect(report).toContain('bridge helper_termination generation=1 context=generation_failure result=unconfirmed waitMs=25')
  })

  it('bounds affinity polling without evicting overlay debug evidence', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({ kind: 'debug_always_on_top_request', requested: true, nativeBefore: false, nativeAfter: true })
    for (let i = 0; i < 200; i++) {
      buf.push({ kind: 'affinity', processCount: i, selectedPid: i, comPid: i, mismatch: i % 2 === 0 })
    }
    const report = buf.buildReport(meta)
    expect(buf.count).toBe(AFFINITY_DIAGNOSTICS_CAPACITY + 1)
    expect(report).toContain('debug_always_on_top_request requested=true nativeBefore=false nativeAfter=true')
    expect((report.match(/app affinity /g) ?? [])).toHaveLength(AFFINITY_DIAGNOSTICS_CAPACITY)
  })
})

describe('buildReport includes the S-026 diagnostic surface', () => {
  it('records versions, signing, affinity, slide/media, display, and bounds', () => {
    const buf = new DiagnosticsBuffer()
    buf.pushBridge({ kind: 'helper_start', generation: 1 })
    buf.push({ kind: 'slide_observed', slideNumber: 3, mediaCount: 1, selectedMediaId: 502, selectedMediaIndex: 0 })
    buf.push({ kind: 'affinity', processCount: 2, selectedPid: 1234, comPid: 5678, mismatch: true })
    buf.push({ kind: 'display_change', displayId: '2', scaleFactor: 1.5, displayCount: 2 })
    buf.push({ kind: 'window_bounds', x: 100, y: 200, width: 360, height: 220 })
    const report = buf.buildReport(meta)
    for (const needle of [
      'appVersion: 0.1.0-beta.1',
      'protocolVersion: 1',
      'signingStatus: unsigned-beta',
      'generation=1',
      'slide=3',
      'mediaCount=1',
      'selectedMediaId=502',
      'selectedMediaIndex=0',
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
    buf.push({ kind: 'slide_observed', slideNumber: 3, mediaCount: 1, selectedMediaId: 502, selectedMediaIndex: 0 })
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

describe('isOverlayDebug (PPT_TIMER_DEBUG gating)', () => {
  it('is false by default, when unset, and for any non-"1" value', () => {
    expect(isOverlayDebug({})).toBe(false)
    expect(isOverlayDebug({ [OVERLAY_DEBUG_ENV]: '' })).toBe(false)
    expect(isOverlayDebug({ [OVERLAY_DEBUG_ENV]: 'true' })).toBe(false)
    expect(isOverlayDebug({ [OVERLAY_DEBUG_ENV]: '0' })).toBe(false)
  })

  it('is true only for the exact "1" sentinel', () => {
    expect(isOverlayDebug({ [OVERLAY_DEBUG_ENV]: '1' })).toBe(true)
  })

  it('reads the live process.env when no argument is given', () => {
    const saved = process.env[OVERLAY_DEBUG_ENV]
    try {
      delete process.env[OVERLAY_DEBUG_ENV]
      expect(isOverlayDebug()).toBe(false)
      process.env[OVERLAY_DEBUG_ENV] = '1'
      expect(isOverlayDebug()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env[OVERLAY_DEBUG_ENV]
      else process.env[OVERLAY_DEBUG_ENV] = saved
    }
  })
})

describe('overlay debug events in the report (PPT_TIMER_DEBUG=1 surface)', () => {
  // The buffer itself does not gate debug events (the call site in main.ts does,
  // behind isOverlayDebug); these tests pin the formatting so the report renders
  // every field a Presenter View repro needs.
  it('formats the launch snapshot with topology and the full state tuple', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({
      kind: 'debug_launch_snapshot',
      displayCount: 2,
      primaryId: '692542',
      savedAlwaysOnTop: true,
      bx: 10,
      by: 20,
      bw: 360,
      bh: 220,
      visible: true,
      minimized: false,
      focused: false,
      alwaysOnTop: true,
    })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_launch_snapshot displayCount=2 primaryId=692542 savedAlwaysOnTop=true actualAlwaysOnTop=true bounds=10,20,360,220')
    expect(report).toContain('savedAlwaysOnTop=true actualAlwaysOnTop=true')
    expect(report).toContain('visible=true minimized=false focused=false')
  })

  it('formats a window lifecycle event with matched display id and scale factor', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({
      kind: 'debug_window_event',
      event: 'blur',
      visible: true,
      minimized: false,
      focused: false,
      alwaysOnTop: true,
      bx: 10,
      by: 20,
      bw: 360,
      bh: 220,
      displayId: '692542',
      scaleFactor: 1.5,
    })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_window_event event=blur')
    expect(report).toContain('bounds=10,20,360,220 displayId=692542 scaleFactor=1.5')
    expect(report).toContain('alwaysOnTop=true')
  })

  it('formats always-on-top requests and passive delayed focus snapshots', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({ kind: 'debug_always_on_top_request', requested: false, nativeBefore: true, nativeAfter: false })
    buf.push({ kind: 'debug_delayed_window_snapshot', trigger: 'blur', delayMs: 500, visible: true, minimized: false, focused: false, alwaysOnTop: false, bx: 10, by: 20, bw: 360, bh: 220, displayId: '692542', scaleFactor: 1.5 })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_always_on_top_request requested=false nativeBefore=true nativeAfter=false')
    expect(report).toContain('debug_delayed_window_snapshot trigger=blur delayMs=500')
    expect(report).toContain('alwaysOnTop=false bounds=10,20,360,220 displayId=692542')
  })

  it('formats moved/resized with the matched work area for clamping analysis', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({
      kind: 'debug_moved_resized',
      event: 'resized',
      bx: 10,
      by: 20,
      bw: 360,
      bh: 220,
      displayId: '692542',
      scaleFactor: 1.5,
      wx: 0,
      wy: 0,
      ww: 1920,
      wh: 1040,
    })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_moved_resized event=resized')
    expect(report).toContain('workArea=0,0,1920,1040')
    expect(report).toContain('displayId=692542 scaleFactor=1.5')
  })

  it('formats display add/remove/metrics events with display count and work area', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({ kind: 'debug_display_event', event: 'display-metrics-changed', displayId: '692542', displayCount: 3, scaleFactor: 2, wx: 0, wy: 0, ww: 2560, wh: 1400 })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_display_event event=display-metrics-changed displayId=692542 displayCount=3 scaleFactor=2 workArea=0,0,2560,1400')
  })

  it('formats programmatic bounds before/after with the reason', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({
      kind: 'debug_programmatic_bounds',
      reason: 'revalidate',
      bxBefore: 10,
      byBefore: 20,
      bwBefore: 360,
      bhBefore: 220,
      bxAfter: 780,
      byAfter: 410,
      bwAfter: 360,
      bhAfter: 220,
      displayId: '692542',
    })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_programmatic_bounds reason=revalidate before=10,20,360,220 after=780,410,360,220 displayId=692542')
  })

  it('formats placement decisions with outcome and visible/target displays', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({ kind: 'debug_placement_decision', outcome: 'recentered', visibleOnDisplayId: null, targetDisplayId: '692542', bx: 780, by: 410, bw: 360, bh: 220 })
    buf.push({ kind: 'debug_placement_decision', outcome: 'kept', visibleOnDisplayId: '692542', targetDisplayId: '692542', bx: 10, by: 20, bw: 360, bh: 220 })
    const report = buf.buildReport(meta)
    expect(report).toContain('debug_placement_decision outcome=recentered visibleOnDisplayId=-- targetDisplayId=692542 bounds=780,410,360,220')
    expect(report).toContain('debug_placement_decision outcome=kept visibleOnDisplayId=692542 targetDisplayId=692542')
  })

  it('carries no PII: only scalar geometry/state, never titles or process names', () => {
    const buf = new DiagnosticsBuffer()
    buf.push({ kind: 'debug_window_event', event: 'blur', visible: true, minimized: false, focused: false, alwaysOnTop: true, bx: 1, by: 2, bw: 3, bh: 4, displayId: '692542', scaleFactor: 1 })
    buf.push({ kind: 'debug_launch_snapshot', displayCount: 1, primaryId: '692542', savedAlwaysOnTop: true, bx: 1, by: 2, bw: 3, bh: 4, visible: true, minimized: false, focused: false, alwaysOnTop: true })
    const report = buf.buildReport(meta)
    expect(report).not.toContain('POWERPNT')
    expect(report).not.toContain('Presenter')
    expect(report).not.toContain('password')
    expect(report).not.toContain('SECRET')
  })
})
