import type { AppView, PanelMode } from '../shared/ipc-contract.js'

export type PanelOwnership = 'auto' | 'manual' | null

export type PanelSessionState = {
  mode: PanelMode
  ownership: PanelOwnership
  slideKey: string | null
  dismissedSlideKey: string | null
}

export const INITIAL_PANEL_STATE: PanelSessionState = {
  mode: 'closed',
  ownership: null,
  slideKey: null,
  dismissedSlideKey: null,
}

/** Best stable slide identity available in the projected renderer view. */
export function currentSlideKey(view: AppView): string | null {
  const state = view.state
  if (!('slideNumber' in state) || typeof state.slideNumber !== 'number') return null
  const filename = 'filenameBasename' in state ? state.filenameBasename : undefined
  const title = 'title' in state ? state.title : undefined
  const totalSlides = 'totalSlides' in state ? state.totalSlides : undefined
  return JSON.stringify([title || filename || '', totalSlides ?? null, state.slideNumber])
}

/** Apply automatic multi-video opening without overriding manual ownership. */
export function reconcilePanelState(
  state: PanelSessionState,
  slideKey: string | null,
  totalVideoCount: number,
  autoOpenVideoList: boolean,
): PanelSessionState {
  const slideChanged = slideKey !== state.slideKey
  let next: PanelSessionState = slideChanged
    ? { ...state, slideKey, dismissedSlideKey: null }
    : state

  if (next.ownership === 'manual') return next
  if (!autoOpenVideoList) {
    return next.ownership === 'auto'
      ? { ...next, mode: 'closed', ownership: null }
      : next
  }
  if (next.ownership === 'auto') {
    return totalVideoCount > 1
      ? { ...next, mode: 'videos' }
      : { ...next, mode: 'closed', ownership: null }
  }
  if (
    next.mode === 'closed' &&
    slideKey !== null &&
    totalVideoCount > 1 &&
    next.dismissedSlideKey !== slideKey
  ) {
    next = { ...next, mode: 'videos', ownership: 'auto' }
  }
  return next
}

/** Any explicit disclosure action transfers ownership to the operator. */
export function applyManualPanelMode(
  state: PanelSessionState,
  mode: PanelMode,
  totalVideoCount: number,
): PanelSessionState {
  if (mode === 'closed') {
    return {
      ...state,
      mode,
      ownership: null,
      dismissedSlideKey: totalVideoCount > 1 ? state.slideKey : state.dismissedSlideKey,
    }
  }
  return { ...state, mode, ownership: 'manual' }
}
