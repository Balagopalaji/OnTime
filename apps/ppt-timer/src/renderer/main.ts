/**
 * Plain renderer entry (ISSUE-001 H5, S-014/S-017/S-033). No Node, no Electron,
 * no framework, no remote content: it renders the immutable {@link AppView}
 * pushed from the main process and sends closed-union {@link RendererAction}s
 * back through the sandboxed preload bridge. All display formatting is delegated
 * to `describeView`. User-derived strings go through `textContent`, never
 * `innerHTML`, so a deck name can never inject markup.
 *
 * Smoothing lives HERE and nowhere else: the projection stays clock-free
 * (bounded S-017 behavior) and IPC traffic is unchanged. The renderer's playback clock accepts
 * the first trusted playing measurement, then advances locally between polls.
 * Newer COM readings confirm playback but do not reset that clock unless the
 * player stops, identity/duration changes, or two newer readings consistently
 * confirm a material correction. A 250 ms tick patches ONLY timer strings.
 */
import {
  announcementFor,
  describeView,
  SMOOTHING_TICK_MS,
} from './view.js'
import type { AppView, PanelMode, PreloadApi, RendererAction } from '../shared/ipc-contract.js'
import { createPlaybackClock } from './playback-clock.js'
import { applyManualPanelMode, currentSlideKey, INITIAL_PANEL_STATE, reconcilePanelState } from './panel-state.js'
import { renderOptionStrip, renderWindowControls } from './panel-options.js'
import { renderPowerPointPanel, renderVideoList, setTimerText } from './powerpoint-panel.js'

declare global {
  interface Window {
    ontime?: PreloadApi
  }
}

type Dispatch = (action: RendererAction) => void

type ControlsOptions = {
  panelMode: PanelMode
  setPanelMode: (mode: PanelMode) => void
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderStatus(view: AppView, advanceMs: number): HTMLElement {
  return renderPowerPointPanel(describeView(view.state, { timingMode: view.timingMode, advanceMs }))
}

function renderControls(view: AppView, dispatch: Dispatch, options: ControlsOptions): HTMLElement {
  const section = element('section', 'controls')
  section.dataset.panelMode = options.panelMode
  const model = describeView(view.state, { timingMode: view.timingMode })
  const videoRows = model.videoRows
  section.dataset.videoSignature = JSON.stringify(videoRows.map((row) => [row.key, row.nameText, row.statusText]))

  if (options.panelMode === 'closed') {
    const open = element('button', 'settings-toggle')
    open.type = 'button'
    open.id = 'settings-toggle'
    open.setAttribute('aria-expanded', 'false')
    open.setAttribute('aria-label', videoRows.length > 1 ? 'Show video list' : 'Show timer options')
    open.title = videoRows.length > 1 ? 'Show video list' : 'Show timer options'
    open.append(element('span', 'settings-caret'))
    open.addEventListener('click', () => options.setPanelMode(videoRows.length > 1 ? 'videos' : 'options'))
    section.append(open)
    return section
  }

  const tray = element('section', 'panel-tray')
  tray.id = 'panel-tray'
  tray.setAttribute('role', 'region')
  tray.setAttribute('aria-label', options.panelMode === 'videos' ? 'Video list' : 'Timer options')
  const list = renderVideoList(videoRows)
  if (list) tray.append(list)

  const nav = element('div', 'tray-nav')
  const collapse = element('button', 'tray-button tray-collapse', '▴')
  collapse.type = 'button'
  collapse.id = 'panel-collapse'
  collapse.title = 'Collapse whole tray'
  collapse.setAttribute('aria-label', 'Collapse whole tray')
  collapse.addEventListener('click', () => options.setPanelMode('closed'))
  nav.append(collapse)
  const optionsOpen = options.panelMode === 'options'
  const switcher = element('button', 'tray-button tray-switch', '⚙')
  switcher.type = 'button'
  switcher.id = 'panel-switch'
  switcher.title = optionsOpen ? 'Hide options' : 'Show options'
  switcher.setAttribute('aria-label', switcher.title)
  switcher.setAttribute('aria-expanded', String(optionsOpen))
  switcher.setAttribute('aria-pressed', String(optionsOpen))
  switcher.addEventListener('click', () => {
    options.setPanelMode(optionsOpen ? (videoRows.length > 1 ? 'videos' : 'closed') : 'options')
  })
  nav.append(switcher)
  tray.append(nav)

  if (options.panelMode === 'videos') {
    section.append(tray)
    return section
  }

  tray.append(renderOptionStrip(view, dispatch))
  section.append(tray)

  return section
}

/**
 * Bring an existing controls section in line with `view` WITHOUT recreating it.
 * Returns false when the change is structural — the display selector or the CTA
 * appearing or disappearing — in which case the caller rebuilds.
 *
 * This exists because the host publishes a view on every poll (~1 s), so a full
 * repaint of the controls detached whatever the user was interacting with once a
 * second: keyboard focus dropped to the body and an open display dropdown
 * closed. Patching in place keeps focus and open popups alive between polls.
 */
function patchControls(section: HTMLElement, view: AppView, options: ControlsOptions): boolean {
  if (section.dataset.panelMode !== options.panelMode) return false
  const model = describeView(view.state, { timingMode: view.timingMode })
  const videoRows = model.videoRows
  const signature = JSON.stringify(videoRows.map((row) => [row.key, row.nameText, row.statusText]))
  if (section.dataset.videoSignature !== signature) return false
  if (options.panelMode === 'closed') return true

  const timing = section.querySelector<HTMLButtonElement>('#timing-mode')
  if (timing !== null) {
    const nextMode = view.timingMode === 'remaining' ? 'elapsed' : 'remaining'
    timing.dataset.mode = view.timingMode
    timing.textContent = view.timingMode === 'remaining' ? 'Remaining' : 'Elapsed'
    timing.title = `Show ${nextMode} time`
    timing.setAttribute('aria-label', `Switch to ${nextMode} timing`)
  }
  section.querySelector('#always-on-top')?.setAttribute('aria-pressed', String(view.alwaysOnTop))
  section.querySelector('#auto-open-video-list')?.setAttribute('aria-pressed', String(view.autoOpenVideoList))
  const rowNodes = section.querySelectorAll<HTMLElement>('.video-row')
  videoRows.forEach((row, index) => {
    const item = rowNodes[index]
    if (!item) return
    const name = item.querySelector('.video-row-name')
    const status = item.querySelector<HTMLElement>('.video-row-status')
    const time = item.querySelector('.video-row-time')
    if (name && name.textContent !== row.nameText) name.textContent = row.nameText
    if (status) {
      if (status.textContent !== row.statusText) status.textContent = row.statusText
      status.dataset.status = row.statusText.toLowerCase()
    }
    if (time && time.textContent !== row.timeText) time.textContent = row.timeText
  })
  return true
}

/** Restore focus by stable control id after an unavoidable structural redraw. */
function focusedControlId(section: HTMLElement): string | null {
  const active = document.activeElement
  return active instanceof HTMLElement && section.contains(active) && active.id.length > 0 ? active.id : null
}

/**
 * Replace the app root with a fresh render of the immutable view (S-013). This
 * is the first paint `mountApp` performs; every later view is painted
 * incrementally by its `paint`, which reuses the same two builders.
 */
export function renderApp(
  root: HTMLElement,
  view: AppView,
  dispatch: Dispatch,
  advanceMs = 0,
  controls: ControlsOptions = { panelMode: 'closed', setPanelMode: () => {} },
): void {
  root.dataset.panelMode = controls.panelMode
  root.replaceChildren(
    renderStatus(view, advanceMs),
    renderControls(view, dispatch, controls),
    renderWindowControls(dispatch),
  )
}

/**
 * Patch ONLY the timer strings of an already-rendered view. The interpolation
 * tick calls this so nothing else in the DOM churns: no node is recreated, no
 * listener is rebound, and no status/message text (and therefore no live-region
 * content) changes. Row order matches the render exactly, both coming from the
 * same model.
 */
export function patchTimers(root: HTMLElement, view: AppView, advanceMs: number): void {
  const model = describeView(view.state, { timingMode: view.timingMode, advanceMs })
  const time = root.querySelector('#time')
  if (time instanceof HTMLElement) setTimerText(time, model.timeText)
  const rowTimes = root.querySelectorAll('.video-row .video-row-time')
  model.videoRows.forEach((row, index) => {
    const node = rowTimes[index]
    if (node && node.textContent !== row.timeText) node.textContent = row.timeText
  })
}

/** Monotonic where available; `performance.now()` never jumps with the clock. */
function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/**
 * Wire the preload bridge: subscribe to pushes, render the initial view, and run
 * the bounded local smoothing tick. The returned function stops the tick and
 * unsubscribes.
 */
export function mountApp(options: {
  root: HTMLElement
  api: PreloadApi
  /** Injectable local monotonic clock (tests); defaults to `performance.now()`. */
  now?: () => number
  /**
   * Polite live region for status announcements. Omit the key to look up
   * `#announcer` by id; pass an explicit `null` to disable announcements.
   */
  announcer?: HTMLElement | null
}): () => void {
  const { root, api } = options
  const now = options.now ?? defaultNow
  // An EXPLICIT `announcer: null` means "no live region", so it must not fall
  // through to the id lookup the way `??` would. Only an absent key auto-detects.
  const announcer =
    'announcer' in options
      ? options.announcer
      : typeof document !== 'undefined'
        ? document.getElementById('announcer')
        : null
  const dispatch: Dispatch = (action) => {
    void api.dispatch(action)
  }
  // `revision` is monotonic; drop any view older than the last one rendered so a
  // late-resolving getView() cannot overwrite a newer pushed view and restore
  // stale timing after an `unavailable` transition (S-013). A dropped view also
  // leaves the observation anchor alone, so it cannot rewind newer timing.
  let lastRevision = -1
  let current: AppView | null = null
  const playbackClock = createPlaybackClock()
  let announced: string | null = null
  let statusNode: HTMLElement | null = null
  let controlsNode: HTMLElement | null = null
  let panelState = INITIAL_PANEL_STATE
  let panelVideoCount = 0

  const totalVideoCount = (view: AppView | null): number =>
    view === null
      ? 0
      : describeView(view.state, { timingMode: view.timingMode }).videoRows.length

  const controlsOptions = (): ControlsOptions => ({
    panelMode: panelState.mode,
    setPanelMode,
  })

  /** Panel mode is transient. The main process derives dimensions from this
   * closed mode/count pair; the renderer never supplies pixel geometry. */
  function setPanelMode(requested: PanelMode): void {
    const count = totalVideoCount(current)
    const mode = requested === 'videos' && count <= 1 ? 'options' : requested
    panelState = applyManualPanelMode(panelState, mode, count)
    panelVideoCount = count
    root.dataset.panelMode = mode
    dispatch({ type: 'setPanelMode', mode, totalVideoCount: count })
    if (controlsNode === null || current === null) return
    const nextControls = renderControls(current, dispatch, controlsOptions())
    controlsNode.replaceWith(nextControls)
    controlsNode = nextControls
    const focusTarget = mode === 'closed' ? '#settings-toggle' : '#panel-collapse'
    nextControls.querySelector<HTMLButtonElement>(focusTarget)?.focus()
  }

  /**
   * Paint a view incrementally: a fresh status section (no focusable content),
   * and the SAME controls node patched in place unless the change is structural.
   * Uses the same builders as `renderApp`, so display strings cannot diverge.
   */
  const paint = (view: AppView, advanceMs: number, restoreFocus = true): void => {
    if (statusNode === null || controlsNode === null) {
      // First paint goes through the same full-render entry point the tests
      // exercise, then keeps references for the incremental paints that follow.
      renderApp(root, view, dispatch, advanceMs, controlsOptions())
      statusNode = root.querySelector('.status')
      controlsNode = root.querySelector('.controls')
      return
    }
    const nextStatus = renderStatus(view, advanceMs)
    statusNode.replaceWith(nextStatus)
    statusNode = nextStatus
    if (!patchControls(controlsNode, view, controlsOptions())) {
      const focusId = focusedControlId(controlsNode)
      const nextControls = renderControls(view, dispatch, controlsOptions())
      controlsNode.replaceWith(nextControls)
      controlsNode = nextControls
      if (restoreFocus && focusId) nextControls.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus()
    }
  }

  const render = (view: AppView): void => {
    if (view.revision < lastRevision) return
    lastRevision = view.revision
    const smoothed = playbackClock.accept(view, now())
    current = smoothed
    const count = totalVideoCount(smoothed)
    const previousMode = panelState.mode
    panelState = reconcilePanelState(panelState, currentSlideKey(smoothed), count, smoothed.autoOpenVideoList)
    const automaticModeChange = previousMode !== panelState.mode
    if (automaticModeChange || (panelState.mode !== 'closed' && panelVideoCount !== count)) {
      panelVideoCount = count
      dispatch({ type: 'setPanelMode', mode: panelState.mode, totalVideoCount: count })
    }
    root.dataset.panelMode = panelState.mode
    paint(smoothed, 0, !automaticModeChange)
    if (announcer) {
      const text = announcementFor(describeView(smoothed.state, { timingMode: smoothed.timingMode }))
      if (text !== announced) {
        announced = text
        announcer.textContent = text
      }
    }
  }

  const tick = (): void => {
    const smoothed = playbackClock.current(now())
    if (smoothed === null) return
    current = smoothed
    patchTimers(root, smoothed, 0)
  }

  const unsubscribe = api.subscribe(render)
  const ticker = setInterval(tick, SMOOTHING_TICK_MS)
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && panelState.mode !== 'closed') {
      event.preventDefault()
      setPanelMode(panelState.mode === 'options' && totalVideoCount(current) > 1 ? 'videos' : 'closed')
    }
  }
  document.addEventListener('keydown', onKeyDown)
  void api.getView().then(render)
  return () => {
    if (panelState.mode !== 'closed') {
      dispatch({ type: 'setPanelMode', mode: 'closed', totalVideoCount: totalVideoCount(current) })
    }
    clearInterval(ticker)
    unsubscribe()
    document.removeEventListener('keydown', onKeyDown)
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app')
  if (root && window.ontime) mountApp({ root, api: window.ontime })
}
