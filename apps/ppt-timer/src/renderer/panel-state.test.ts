import { describe, expect, it } from 'vitest'
import type { AppView } from '../shared/ipc-contract'
import {
  applyManualPanelMode,
  currentSlideKey,
  INITIAL_PANEL_STATE,
  reconcilePanelState,
} from './panel-state'

const view = (slideNumber: number, title = 'Deck.pptx'): AppView => ({
  revision: 1,
  ctaAvailable: false,
  state: {
    kind: 'ready',
    slideNumber,
    totalSlides: 20,
    title,
    filenameBasename: title,
    multipleVideos: false,
    videoCount: 0,
    multipleInstanceWarning: false,
    videos: [],
    timeMs: null,
    durationMs: null,
  },
  timingMode: 'remaining',
  alwaysOnTop: true,
  preset: 'compact',
  displays: [],
  selectedDisplayId: null,
})

describe('panel ownership state', () => {
  it('derives a stable key from deck scope and slide number', () => {
    expect(currentSlideKey(view(4))).toBe(currentSlideKey({ ...view(4), revision: 99 }))
    expect(currentSlideKey(view(4))).toBe(currentSlideKey({
      ...view(4),
      state: { ...view(4).state, filenameBasename: undefined } as AppView['state'],
    }))
    expect(currentSlideKey(view(5))).not.toBe(currentSlideKey(view(4)))
    expect(currentSlideKey(view(4, 'Other.pptx'))).not.toBe(currentSlideKey(view(4)))
    expect(currentSlideKey({ ...view(4), state: { kind: 'no_slideshow', multipleVideos: false, videoCount: 0, multipleInstanceWarning: false } })).toBeNull()
  })

  it('auto-opens multi-video slides and auto-closes only auto ownership', () => {
    const opened = reconcilePanelState(INITIAL_PANEL_STATE, currentSlideKey(view(4)), 2)
    expect(opened).toMatchObject({ mode: 'videos', ownership: 'auto' })
    expect(reconcilePanelState(opened, opened.slideKey, 1)).toMatchObject({ mode: 'closed', ownership: null })
    const manual = applyManualPanelMode(opened, 'options', 2)
    expect(reconcilePanelState(manual, manual.slideKey, 1)).toMatchObject({ mode: 'options', ownership: 'manual' })
  })

  it('honours same-slide dismissal and resets it for a new slide', () => {
    const key4 = currentSlideKey(view(4))
    const opened = reconcilePanelState(INITIAL_PANEL_STATE, key4, 3)
    const dismissed = applyManualPanelMode(opened, 'closed', 3)
    expect(reconcilePanelState(dismissed, key4, 3)).toMatchObject({ mode: 'closed', dismissedSlideKey: key4 })
    const next = reconcilePanelState(dismissed, currentSlideKey(view(5)), 3)
    expect(next).toMatchObject({ mode: 'videos', ownership: 'auto', dismissedSlideKey: null })
  })
})
