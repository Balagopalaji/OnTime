// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as face from '@ontime/timer-face'
import { createViewerSession, projectViewerSession, reduceViewerSession } from '@ontime/remote-viewer-contracts'
import { projectPowerPointDisplay } from '@ontime/powerpoint-display'
import type { PowerPointVideoTile, PowerPointViewState } from '@ontime/presentation-core'
import { describeView, formatTime, toDisplayModel } from './view'
import { setTimerText, timerFitWidthCqw } from './powerpoint-panel'

const here = __dirname

describe('ISSUE-002 S4b: the local app uses the shared timer face', () => {
  it('re-exports the shared formatter and fit helpers instead of local copies', () => {
    // Defect: two copies of the time formatter drift and local/remote read a second apart.
    expect(formatTime).toBe(face.formatTime)
    expect(timerFitWidthCqw).toBe(face.timerFitWidthCqw)
    expect(setTimerText).toBe(face.setTimerText)
  })

  it('imports the face stylesheet and keeps only wrapper rules locally', () => {
    // Defect: duplicated face CSS lets the local and remote faces diverge visually.
    const styles = readFileSync(path.join(here, 'styles.css'), 'utf8')
    const main = readFileSync(path.join(here, 'main.ts'), 'utf8')
    expect(main).toContain("import '@ontime/timer-face/timer-face.css'")
    for (const selector of [':root {', '\n.time {', '\n.timer-stack {', '\n.status-label {', '\n.video-row {', '\n.videos {']) {
      expect(styles.includes(selector), selector).toBe(false)
    }
    expect(styles).toContain('-webkit-app-region: drag')
  })
})

/** The same host observation, once as a local view state and once as a published remote snapshot. */
const tile = (p: Partial<PowerPointVideoTile> & { ordinal: number }): PowerPointVideoTile => ({
  status: 'ready', playing: false, durationMs: null, elapsedMs: null, remainingMs: null, isFocus: false, ...p,
})
const deck = { slideNumber: 3, totalSlides: 12, title: 'Sunday', filenameBasename: 'Sunday', multipleInstanceWarning: false }
const intro = { ordinal: 0, name: 'Intro', durationMs: 60_000, isFocus: true }
const outro = { ordinal: 1, name: 'Outro', status: 'paused' as const, durationMs: 30_000, elapsedMs: 9_000, remainingMs: 21_000 }

type Case = { local: string; remote: string; tiles: PowerPointVideoTile[] }
const ACTIVE: Case[] = [
  { local: 'playing', remote: 'playing', tiles: [tile({ ...intro, status: 'playing', playing: true, elapsedMs: 12_000, remainingMs: 48_000 }), tile(outro)] },
  { local: 'paused', remote: 'paused', tiles: [tile({ ...intro, status: 'paused', elapsedMs: 12_000, remainingMs: 48_000 }), tile(outro)] },
  { local: 'ready', remote: 'ready', tiles: [tile(intro), tile({ ordinal: 1, durationMs: 20_000 })] },
  { local: 'ended', remote: 'ended', tiles: [tile({ ...intro, status: 'ended', elapsedMs: 60_000, remainingMs: 0 })] },
  { local: 'no_video', remote: 'no-video', tiles: [] },
  { local: 'timing_unavailable', remote: 'timing-unavailable', tiles: [tile({ ordinal: 0, name: 'Clip', status: 'playing', playing: true })] },
]
const UNAVAILABLE = [
  ['unavailable', 'helper-unavailable'],
  ['powerpoint_not_running', 'no-presentation'],
  ['no_slideshow', 'no-slideshow'],
] as const

const remoteRow = (t: PowerPointVideoTile) => ({
  ordinal: t.ordinal,
  ...(t.name ? { label: t.name } : {}),
  status: t.status,
  durationMs: t.durationMs,
  elapsedMsAtObservation: t.elapsedMs,
  remainingMsAtObservation: t.remainingMs,
  isFocus: t.isFocus,
})

function remoteDisplay(availability: string, payload: unknown) {
  const snapshot = {
    schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: 'sess_1', epoch: 1, sequence: 1,
    observedAtMs: 1_000, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: 5_000,
    heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability, payload,
  }
  const state = reduceViewerSession(createViewerSession('sess_1'), { type: 'snapshot', data: snapshot })
  expect(state.lastOutcome).toBe('applied')
  return projectPowerPointDisplay(projectViewerSession(state, 5_000))
}

const visible = (m: face.TimerDisplayModel) => ({
  statusText: m.statusText, badge: m.badge, timeText: m.timeText, messageText: m.messageText,
  rows: m.disclosureRows.map((r) => [r.nameText, r.statusText, r.timeText, r.isFocus, r.announceLabel]),
})

describe('local and remote PowerPoint adapters agree for every shared state (RPV-002, RPV-003, RPV-006, RPV-008)', () => {
  it.each(ACTIVE)('$local slide renders the same compact face, rows, and announcement', ({ local, remote, tiles }) => {
    // Defect: one adapter's copy or row-time rule changes and local/remote viewers disagree.
    const focus = tiles.find((t) => t.isFocus)
    const localModel = toDisplayModel(describeView({ kind: local, ...deck, timeMs: null, durationMs: null, multipleVideos: tiles.length > 1, videoCount: tiles.length, videos: tiles } as PowerPointViewState))
    const remoteModel = remoteDisplay('active', {
      reason: 'presentation', presentationState: remote, slideNumber: 3, slideCount: 12, displayTitle: 'Sunday',
      headline: { focusedOrdinal: focus?.ordinal ?? null, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: remote === 'timing-unavailable' ? tiles.map((t) => ({ ...remoteRow(t), durationMs: null, elapsedMsAtObservation: null, remainingMsAtObservation: null })) : tiles.map(remoteRow),
    })
    expect(visible(remoteModel)).toEqual(visible(localModel))
    expect(face.announcementFor(remoteModel)).toBe(face.announcementFor(localModel))
  })

  it.each(UNAVAILABLE)('local %s and remote %s render the same unavailable face', (local, reason) => {
    const localModel = toDisplayModel(describeView({ kind: local, multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } as PowerPointViewState))
    const remoteModel = remoteDisplay('source-unavailable', { reason })
    expect(visible(remoteModel)).toEqual(visible(localModel))
    expect(face.announcementFor(remoteModel)).toBe(face.announcementFor(localModel))
  })
})
