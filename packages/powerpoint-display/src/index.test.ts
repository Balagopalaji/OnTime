import { describe, expect, it } from 'vitest'
import { activeSnapshot, playingRow, presentationPayload, readyRow } from '../../remote-viewer-contracts/test/fixtures'
import { projectPowerPointDisplay } from './index'
import { createViewerSession, projectViewerSession, reduceViewerSession, type ViewerProjection } from '@ontime/remote-viewer-contracts'

const PUBLISHED = 1_790_000_000_300

function projectionFor(overrides: Record<string, unknown>, nowMs = PUBLISHED): ViewerProjection {
  const state = reduceViewerSession(createViewerSession('sess_Abc123'), { type: 'snapshot', data: activeSnapshot(overrides) })
  return projectViewerSession(state, nowMs)
}

describe('projectPowerPointDisplay — remote PowerPoint adapter', () => {
  it('renders a live playing slide as the canonical compact face with the focus row as headline', () => {
    // RPV-002/003/006: "Playing" above remaining time; rows carry sanitized names for disclosure.
    // Advance at PUBLISHED is observationAge 40 + transit 180 = 220 ms.
    expect(projectPowerPointDisplay(projectionFor({}))).toEqual({
      connection: 'live',
      stateKey: 'playing',
      statusText: 'Playing',
      badge: 'playing',
      timeText: '01:29',
      disclosureRows: [
        { key: '0', ordinal: 0, nameText: 'Walk-in loop', statusText: 'Playing', timeText: '01:29', isFocus: true, announceLabel: '1. Walk-in loop' },
        { key: '1', ordinal: 1, nameText: 'Sermon bumper', statusText: 'Ready', timeText: '00:45', isFocus: false, announceLabel: '2. Sermon bumper' },
      ],
    })
  })

  it('uses the host-resolved focus and timing mode, never reselecting', () => {
    // RPV-006: headline follows the host's isFocus row even when another row is also playing.
    const payload = presentationPayload({
      headline: { focusedOrdinal: 1, mode: 'latest-started', timingMode: 'elapsed' },
      videos: [
        playingRow({ isFocus: false, remainingMsAtObservation: 110_000, elapsedMsAtObservation: 10_000 }),
        playingRow({ ordinal: 1, label: 'Second', isFocus: true, durationMs: 60_000, elapsedMsAtObservation: 5_000, remainingMsAtObservation: 55_000 }),
      ],
    })
    const display = projectPowerPointDisplay(projectionFor({ payload }))
    expect(display.timeText).toBe('00:05')
    expect(display.disclosureRows.map((row) => [row.nameText, row.isFocus, row.timeText])).toEqual([
      ['Walk-in loop', false, '00:10'],
      ['Second', true, '00:05'],
    ])
  })

  it.each([
    ['paused', { presentationState: 'paused', videos: [playingRow({ status: 'paused' })] }, { statusText: 'Paused', badge: 'paused', timeText: '01:30' }],
    ['ready', { presentationState: 'ready', videos: [readyRow({ ordinal: 0, isFocus: true })] }, { statusText: 'Ready', timeText: '00:45', messageText: 'Ready' }],
    ['ended', { presentationState: 'ended', videos: [playingRow({ status: 'ended', remainingMsAtObservation: 0, elapsedMsAtObservation: 120_000 })] }, { statusText: 'Ended', timeText: '00:00', messageText: 'Ended' }],
    ['no video', { presentationState: 'no-video', headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' }, videos: [] }, { statusText: 'No video on this slide', timeText: '--:--', messageText: 'No video on this slide' }],
  ])('maps a %s slide with the same copy as the local app', (_label, payloadOverrides, expected) => {
    const display = projectPowerPointDisplay(projectionFor({ payload: presentationPayload(payloadOverrides) }))
    expect(display).toMatchObject({ connection: 'live', ...expected })
    if (!('badge' in expected)) expect(display.badge).toBeUndefined()
  })

  it('shows no numeric timing when the host reports timing unavailable', () => {
    const payload = presentationPayload({
      presentationState: 'timing-unavailable',
      headline: { focusedOrdinal: null, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [playingRow({ isFocus: false, durationMs: null, elapsedMsAtObservation: null, remainingMsAtObservation: null })],
    })
    const display = projectPowerPointDisplay(projectionFor({ payload }))
    expect(display).toMatchObject({ statusText: 'Timing unavailable', timeText: '--:--' })
    expect(display.disclosureRows[0].timeText).toBe('--:--')
  })

  it.each([
    ['helper-unavailable', { statusText: 'Retrying', badge: 'retry', messageText: 'PowerPoint timing unavailable' }],
    ['no-presentation', { statusText: 'PowerPoint is not running', messageText: 'PowerPoint is not running' }],
    ['no-slideshow', { statusText: 'No slideshow running', messageText: 'No slideshow running' }],
  ])('shows source-unavailable %s explicitly with no timing (RPV-008)', (reason, expected) => {
    const display = projectPowerPointDisplay(projectionFor({ availability: 'source-unavailable', payload: { reason } }))
    expect(display).toMatchObject({ connection: 'unavailable', timeText: '--:--', disclosureRows: [], ...expected })
  })

  it('marks a stale face, freezes its value, and labels it without claiming playback (RPV-008)', () => {
    // Defect: a stale viewer keeps a green "Playing" badge on a frozen countdown.
    const display = projectPowerPointDisplay(projectionFor({}, PUBLISHED + 30_000))
    expect(display).toMatchObject({ connection: 'stale', stateKey: 'playing', statusText: 'Reconnecting', badge: 'warning', timeText: '01:05' })
    expect(display.messageText).toBe('Connection stale; showing the last update')
  })

  it('removes numeric timing once disconnected (RPV-008)', () => {
    const display = projectPowerPointDisplay(projectionFor({}, PUBLISHED + 61_000))
    expect(display).toMatchObject({ connection: 'disconnected', statusText: 'Disconnected', badge: 'warning', timeText: '--:--' })
    expect(display.disclosureRows.map((row) => row.timeText)).toEqual(['--:--', '--:--'])
  })

  it.each([
    [{ connection: 'connecting' }, { connection: 'connecting', statusText: 'Connecting', timeText: '--:--', messageText: 'Connecting to the show' }],
    [{ connection: 'ended' }, { connection: 'ended', stateKey: 'session-ended', statusText: 'Session ended', timeText: '--:--', messageText: 'This show has ended' }],
    [{ connection: 'access-ended' }, { connection: 'ended', stateKey: 'access-ended', statusText: 'Access ended', timeText: '--:--', messageText: 'This viewer link is no longer valid' }],
    [{ connection: 'incompatible' }, { connection: 'unavailable', stateKey: 'incompatible', statusText: 'Update required', badge: 'warning', timeText: '--:--', messageText: 'This show uses a newer version; update the viewer' }],
  ] as const)('maps viewer state %j', (projection, expected) => {
    expect(projectPowerPointDisplay(projection as ViewerProjection)).toEqual({ ...expected, disclosureRows: [] })
  })

  it('maps a host still connecting to PowerPoint', () => {
    const display = projectPowerPointDisplay(projectionFor({ availability: 'connecting', payload: null }))
    expect(display).toMatchObject({ connection: 'live', statusText: 'Connecting to PowerPoint', timeText: '--:--' })
  })
})
