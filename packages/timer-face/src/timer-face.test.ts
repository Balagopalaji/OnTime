// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GOLDEN } from '../test/goldens'
import {
  announcementFor,
  formatTime,
  patchTimerFace,
  renderDisclosureList,
  renderTimerFace,
  timerFitWidthCqw,
  type DisclosureRow,
  type TimerDisplayModel,
} from './index'

/** Display models an adapter must produce for the characterized PowerPoint states. */
const rows = {
  two: [
    { key: '0', ordinal: 0, nameText: 'Intro.mp4', statusText: 'Playing', timeText: '00:48', isFocus: true, announceLabel: '1. Intro.mp4' },
    { key: '1', ordinal: 1, nameText: 'Outro.mp4', statusText: 'Paused', timeText: '00:21', isFocus: false, announceLabel: '2. Outro.mp4' },
  ],
  paused: [{ key: '0', ordinal: 0, nameText: 'Video 1', statusText: 'Paused', timeText: '1:03:20', isFocus: true, announceLabel: '1. Video 1' }],
  ready: [{ key: '0', ordinal: 0, nameText: 'Bumper', statusText: 'Ready', timeText: '00:45', isFocus: true, announceLabel: '1. Bumper' }],
  timing: [{ key: '0', ordinal: 0, nameText: 'Clip', statusText: 'Playing', timeText: '--:--', isFocus: false, announceLabel: '1. Clip' }],
} satisfies Record<string, DisclosureRow[]>

const models: Record<keyof typeof GOLDEN, TimerDisplayModel> = {
  connecting: { connection: 'connecting', stateKey: 'connecting', statusText: 'Connecting to PowerPoint', messageText: 'Connecting to PowerPoint…', timeText: '--:--', disclosureRows: [] },
  unavailable: { connection: 'unavailable', stateKey: 'unavailable', statusText: 'Retrying', badge: 'retry', messageText: 'PowerPoint timing unavailable', timeText: '--:--', disclosureRows: [] },
  notRunning: { connection: 'unavailable', stateKey: 'powerpoint_not_running', statusText: 'PowerPoint is not running', messageText: 'PowerPoint is not running', timeText: '--:--', disclosureRows: [] },
  noVideo: { connection: 'live', stateKey: 'no_video', statusText: 'No video on this slide', messageText: 'No video on this slide', timeText: '--:--', disclosureRows: [] },
  playingTwo: {
    connection: 'live', stateKey: 'playing', statusText: 'Playing', badge: 'playing', timeText: '00:48', disclosureRows: rows.two,
    alertText: 'Multiple PowerPoint instances detected; verify the deck',
  },
  pausedOne: { connection: 'live', stateKey: 'paused', statusText: 'Paused', badge: 'paused', timeText: '1:03:20', disclosureRows: rows.paused },
  readyOne: { connection: 'live', stateKey: 'ready', statusText: 'Ready', messageText: 'Ready', timeText: '00:45', disclosureRows: rows.ready },
  timingUnavailable: { connection: 'live', stateKey: 'timing_unavailable', statusText: 'Timing unavailable', timeText: '--:--', disclosureRows: rows.timing },
  playingZeroRows: { connection: 'live', stateKey: 'playing', statusText: 'Playing', badge: 'playing', timeText: '00:48', disclosureRows: [], announceDetail: 'Intro.mp4' },
}

describe('timer face characterization (pre-extraction ppt-timer DOM)', () => {
  it.each(Object.keys(GOLDEN) as Array<keyof typeof GOLDEN>)('%s renders the identical status, list, and announcement', (name) => {
    // Defect: extraction changes the compact face's markup, copy, fit width, or live-region text.
    const model = models[name]
    expect(renderTimerFace(model).outerHTML).toBe(GOLDEN[name].status)
    expect(renderDisclosureList(model.disclosureRows)?.outerHTML ?? null).toBe(GOLDEN[name].list)
    expect(announcementFor(model)).toBe(GOLDEN[name].announcement)
  })
})

describe('formatTime and fit', () => {
  it.each([
    [null, '--:--'], [Number.NaN, '--:--'], [0, '00:00'], [59_999, '00:59'], [-5_000, '00:00'],
    [3_599_999, '59:59'], [3_600_000, '1:00:00'], [36_000_000, '10:00:00'],
  ])('formats %j as %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text)
  })

  it('narrows the fit width as the time string widens', () => {
    expect(timerFitWidthCqw('--:--')).toBe(41.78)
    expect(timerFitWidthCqw('00:48')).toBe(37.75)
    expect(timerFitWidthCqw('1:03:20')).toBe(28.48)
  })
})

describe('source-neutral use', () => {
  it('renders a non-PowerPoint stage-timer model with generic copy and no PowerPoint wording', () => {
    // Defect: the shell hard-codes PowerPoint states or copy, so a stage-timer adapter cannot reuse it.
    const stage: TimerDisplayModel = {
      connection: 'live',
      timeText: '04:30',
      statusText: 'Running',
      badge: 'playing',
      disclosureRows: [{ key: 'seg-2', nameText: 'Sermon', statusText: 'Running', timeText: '04:30', isFocus: true }],
    }
    const face = renderTimerFace(stage)
    expect(face.dataset.state).toBe('live')
    expect(face.querySelector('#badge')?.textContent).toBe('Running')
    expect(face.querySelector('#time')?.textContent).toBe('04:30')
    const list = renderDisclosureList(stage.disclosureRows)
    expect(list?.querySelector('.video-row')?.hasAttribute('data-ordinal')).toBe(false)
    expect(announcementFor(stage)).toBe('Running — Sermon')
    expect(face.outerHTML + (list?.outerHTML ?? '')).not.toMatch(/PowerPoint|slide/i)
  })

  it.each(['stale', 'disconnected'] as const)('marks a %s face with data-connection even when an adapter sets its own stateKey', (connection) => {
    // Defect: a source stateKey (e.g. playing) displaces the freshness hook, so a frozen time looks live.
    const face = renderTimerFace({ connection, stateKey: 'playing', timeText: '00:10', statusText: 'Playing', badge: 'playing', disclosureRows: [] })
    expect(face.dataset.state).toBe('playing')
    expect(face.dataset.connection).toBe(connection)
    document.body.replaceChildren(face)
    const style = document.createElement('style')
    style.textContent = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'timer-face.css'), 'utf8')
    document.head.replaceChildren(style)
    expect(document.querySelectorAll('.status[data-connection="stale"] .time, .status[data-connection="disconnected"] .time')).toHaveLength(1)
  })

  it.each(['connecting', 'live', 'ended', 'unavailable'] as const)('adds no data-connection for %s (local DOM unchanged)', (connection) => {
    expect(renderTimerFace({ connection, timeText: '00:10', statusText: 'X', disclosureRows: [] }).hasAttribute('data-connection')).toBe(false)
  })

  it('imports nothing outside the package (no PowerPoint, Firebase, Electron, or app code)', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
      expect(specifiers.filter((s) => !s.startsWith('./')), file).toEqual([])
    }
  })
})

describe('patchTimerFace', () => {
  it('updates only the headline and row times, keeping nodes and status text', () => {
    // Defect: the interpolation tick recreates nodes (dropping focus) or rewrites live-region copy.
    const root = document.createElement('main')
    const model = models.playingTwo
    root.append(renderTimerFace(model), renderDisclosureList(model.disclosureRows) as HTMLElement)
    const time = root.querySelector('#time') as HTMLElement
    const badge = root.querySelector('#badge')
    patchTimerFace(root, {
      ...model,
      timeText: '1:00:00',
      disclosureRows: model.disclosureRows.map((row, i) => ({ ...row, timeText: i === 0 ? '1:00:00' : row.timeText })),
    })
    expect(root.querySelector('#time')).toBe(time)
    expect(time.textContent).toBe('1:00:00')
    expect(time.style.getPropertyValue('--time-fit-width')).toBe('28.48cqw')
    expect([...root.querySelectorAll('.video-row-time')].map((n) => n.textContent)).toEqual(['1:00:00', '00:21'])
    expect(root.querySelector('#badge')).toBe(badge)
  })
})

describe('face stylesheet', () => {
  const css = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'timer-face.css'), 'utf8')
  const rule = (selector: string) => {
    const match = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)
    return match?.[2].trim() ?? null
  }

  it('carries the compact palette, stack, time, and list rules without Electron drag regions', () => {
    for (const selector of [':root', '.status', '.status-label', '.timer-stack', '.time', '.videos', '.video-row', '.video-row-status', '.video-row-time']) {
      expect(rule(selector), selector).not.toBeNull()
    }
    expect(rule('.time')).toContain('font-size: clamp(32px, min(var(--time-fit-width), 88cqh), 1000px);')
    expect(css).not.toContain('-webkit-app-region')
    expect(rule('.badge[data-badge="warning"]')).toBe('color: var(--warning);')
    expect(css).toContain('.status[data-connection="stale"] .time,\n.status[data-connection="disconnected"] .time {')
  })
})
