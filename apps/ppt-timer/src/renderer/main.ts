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
import type { AppView, PreloadApi, RendererAction } from '../shared/ipc-contract.js'
import { createPlaybackClock } from './playback-clock.js'
import { renderPowerPointPanel, renderVideoList } from './powerpoint-panel.js'

declare global {
  interface Window {
    ontime?: PreloadApi
  }
}

type Dispatch = (action: RendererAction) => void

type ControlsOptions = {
  settingsOpen: boolean
  toggleSettings: () => void
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
  section.dataset.settingsOpen = String(options.settingsOpen)

  const settings = element('button', 'settings-toggle')
  settings.type = 'button'
  settings.id = 'settings-toggle'
  settings.setAttribute('aria-expanded', String(options.settingsOpen))
  settings.setAttribute('aria-controls', 'settings-drawer')
  settings.setAttribute('aria-haspopup', 'dialog')
  settings.setAttribute('aria-label', options.settingsOpen ? 'Close settings' : 'Open settings')
  settings.title = options.settingsOpen ? 'Close settings' : 'Open settings'
  settings.append(element('span', 'settings-caret'))
  settings.addEventListener('click', options.toggleSettings)
  section.append(settings)

  // Timer mode is intentionally presentation-only. Settings are renderer-local
  // and deliberately not persisted, so a launch always starts uncluttered.
  if (!options.settingsOpen) return section

  const drawer = element('section', 'settings-drawer')
  drawer.id = 'settings-drawer'
  drawer.setAttribute('role', 'region')
  drawer.setAttribute('aria-labelledby', 'settings-drawer-title')

  const heading = element('div', 'drawer-heading')
  const drawerTitle = element('span', 'drawer-title', 'PowerPoint timer')
  drawerTitle.id = 'settings-drawer-title'
  heading.append(drawerTitle)
  heading.append(element('span', 'drawer-subtitle', 'Display settings'))
  drawer.append(heading)

  const settingsGroup = element('div', 'settings-group')
  const nextMode = view.timingMode === 'remaining' ? 'elapsed' : 'remaining'
  const timing = element('button', 'toggle', view.timingMode === 'remaining' ? 'Remaining' : 'Elapsed')
  timing.type = 'button'
  timing.id = 'timing-mode'
  timing.dataset.mode = view.timingMode
  timing.setAttribute('aria-label', `Switch to ${nextMode} timing`)
  timing.addEventListener('click', () => {
    const currentMode = timing.dataset.mode === 'elapsed' ? 'elapsed' : 'remaining'
    dispatch({ type: 'setTimingMode', mode: currentMode === 'remaining' ? 'elapsed' : 'remaining' })
  })
  const timingRow = element('div', 'setting-row')
  timingRow.append(element('span', 'setting-label', 'Timer shows'), timing)
  settingsGroup.append(timingRow)

  const alwaysOnTop = element('label', 'setting-row always-on-top')
  alwaysOnTop.append(element('span', 'setting-label', 'Always on top'))
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.id = 'always-on-top'
  checkbox.setAttribute('aria-label', 'Always on top')
  checkbox.checked = view.alwaysOnTop
  checkbox.addEventListener('change', () => dispatch({ type: 'setAlwaysOnTop', enabled: checkbox.checked }))
  alwaysOnTop.append(checkbox)
  settingsGroup.append(alwaysOnTop)

  const remote = element('label', 'setting-row remote-access')
  remote.append(element('span', 'setting-label', 'Remote viewing'))
  const remoteState = element('span', 'setting-future', 'Coming later')
  const remoteCheckbox = document.createElement('input')
  remoteCheckbox.type = 'checkbox'
  remoteCheckbox.id = 'remote-access'
  remoteCheckbox.disabled = true
  remoteCheckbox.setAttribute('aria-describedby', 'remote-access-state')
  remoteState.id = 'remote-access-state'
  remote.append(remoteState, remoteCheckbox)
  settingsGroup.append(remote)
  drawer.append(settingsGroup)

  const model = describeView(view.state, { timingMode: view.timingMode })
  const secondaryRows = model.videoRows.filter((row) => !row.isFocus)
  section.dataset.videoKeys = secondaryRows.map((row) => row.key).join(',')
  const list = renderVideoList(secondaryRows)
  if (list) {
    const videoGroup = element('div', 'video-group')
    const videoLabel = element('div', 'group-label', 'Other videos')
    videoLabel.id = 'other-videos-title'
    list.setAttribute('aria-labelledby', videoLabel.id)
    videoGroup.append(videoLabel, list)
    drawer.append(videoGroup)
  }

  const copy = element('button', 'copy', 'Copy diagnostics')
  copy.type = 'button'
  copy.id = 'copy-diagnostics'
  copy.addEventListener('click', () => dispatch({ type: 'copyDiagnostics' }))
  drawer.append(copy)

  const windowControls = element('div', 'window-controls')
  const minimize = element('button', 'window-control')
  minimize.type = 'button'
  minimize.id = 'minimize-window'
  minimize.textContent = '\u2212'
  minimize.setAttribute('aria-label', 'Minimize window')
  minimize.title = 'Minimize window'
  minimize.addEventListener('click', () => dispatch({ type: 'minimizeWindow' }))
  const close = element('button', 'window-control close-window')
  close.type = 'button'
  close.id = 'close-window'
  close.textContent = '\u00d7'
  close.setAttribute('aria-label', 'Close timer')
  close.title = 'Close timer'
  close.addEventListener('click', () => dispatch({ type: 'closeWindow' }))
  windowControls.append(minimize, close)
  drawer.append(windowControls)
  section.append(drawer)

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
  if (section.dataset.settingsOpen !== String(options.settingsOpen)) return false
  const settings = section.querySelector<HTMLButtonElement>('#settings-toggle')
  settings?.setAttribute('aria-expanded', String(options.settingsOpen))
  settings?.setAttribute('aria-controls', 'settings-drawer')
  settings?.setAttribute('aria-label', options.settingsOpen ? 'Close settings' : 'Open settings')
  settings?.setAttribute('title', options.settingsOpen ? 'Close settings' : 'Open settings')
  if (!options.settingsOpen) return true

  const timing = section.querySelector<HTMLButtonElement>('#timing-mode')
  if (timing !== null) {
    const nextMode = view.timingMode === 'remaining' ? 'elapsed' : 'remaining'
    timing.dataset.mode = view.timingMode
    timing.textContent = view.timingMode === 'remaining' ? 'Remaining' : 'Elapsed'
    timing.setAttribute('aria-label', `Switch to ${nextMode} timing`)
  }
  const checkbox = section.querySelector<HTMLInputElement>('#always-on-top')
  if (checkbox !== null && checkbox.checked !== view.alwaysOnTop) checkbox.checked = view.alwaysOnTop
  const model = describeView(view.state, { timingMode: view.timingMode })
  const secondaryRows = model.videoRows.filter((row) => !row.isFocus)
  if (section.dataset.videoKeys !== secondaryRows.map((row) => row.key).join(',')) return false
  const rowNodes = section.querySelectorAll<HTMLElement>('.video-row')
  secondaryRows.forEach((row, index) => {
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
  controls: ControlsOptions = { settingsOpen: false, toggleSettings: () => {} },
): void {
  root.replaceChildren(renderStatus(view, advanceMs), renderControls(view, dispatch, controls))
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
  if (time && time.textContent !== model.timeText) time.textContent = model.timeText
  const rowTimes = root.querySelectorAll('.video-row .video-row-time')
  model.videoRows.filter((row) => !row.isFocus).forEach((row, index) => {
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
  let settingsOpen = false

  const controlsOptions = (): ControlsOptions => ({
    settingsOpen,
    toggleSettings: () => setSettingsOpen(!settingsOpen),
  })

  /** Settings are a temporary local view. Rebuilding this small section is
   * intentional when it opens/closes; normal PowerPoint polls still patch it. */
  const setSettingsOpen = (open: boolean): void => {
    if (settingsOpen === open) return
    settingsOpen = open
    if (controlsNode === null || current === null) return
    const active = document.activeElement
    const restoreSettingsFocus = active !== null && controlsNode.contains(active)
    const nextControls = renderControls(current, dispatch, controlsOptions())
    controlsNode.replaceWith(nextControls)
    controlsNode = nextControls
    if (restoreSettingsFocus) nextControls.querySelector<HTMLButtonElement>('#settings-toggle')?.focus()
  }

  /**
   * Paint a view incrementally: a fresh status section (no focusable content),
   * and the SAME controls node patched in place unless the change is structural.
   * Uses the same builders as `renderApp`, so display strings cannot diverge.
   */
  const paint = (view: AppView, advanceMs: number): void => {
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
      if (focusId) nextControls.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus()
    }
  }

  const render = (view: AppView): void => {
    if (view.revision < lastRevision) return
    lastRevision = view.revision
    const smoothed = playbackClock.accept(view, now())
    current = smoothed
    paint(smoothed, 0)
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
    if (event.key === 'Escape' && settingsOpen) {
      event.preventDefault()
      setSettingsOpen(false)
    }
  }
  document.addEventListener('keydown', onKeyDown)
  void api.getView().then(render)
  return () => {
    clearInterval(ticker)
    unsubscribe()
    document.removeEventListener('keydown', onKeyDown)
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app')
  if (root && window.ontime) mountApp({ root, api: window.ontime })
}
