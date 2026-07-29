/**
 * Plain renderer entry (ISSUE-001 H5, S-014/S-017/S-033). No Node, no Electron,
 * no framework, no remote content: it renders the immutable {@link AppView}
 * pushed from the main process and sends closed-union {@link RendererAction}s
 * back through the sandboxed preload bridge. All display formatting is delegated
 * to `describeView`. User-derived strings go through `textContent`, never
 * `innerHTML`, so a deck name can never inject markup.
 *
 * Smoothing lives HERE and nowhere else: the projection stays clock-free
 * (S-017) and IPC traffic is unchanged. Each accepted view is stamped with a
 * local monotonic observation time, and a 250 ms tick patches ONLY the timer
 * strings using a bounded advance ({@link localAdvanceMs}). Every fresh view
 * re-anchors, so a seek, replay, delayed poll, or corrected COM value snaps
 * straight to the newest observation instead of blending across it.
 */
import { announcementFor, describeView, localAdvanceMs, SMOOTHING_TICK_MS, type Badge } from './view.js'
import type { AppView, PreloadApi, RendererAction } from '../shared/ipc-contract.js'

declare global {
  interface Window {
    ontime?: PreloadApi
  }
}

type Dispatch = (action: RendererAction) => void

const BADGE_LABEL: Record<Badge, string> = {
  playing: '▶ Playing',
  paused: '⏸ Paused',
  retry: '⟳ Retrying',
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderStatus(view: AppView, advanceMs: number): HTMLElement {
  const model = describeView(view.state, { timingMode: view.timingMode, advanceMs })
  const section = element('section', 'status')
  section.dataset.state = model.stateKind

  if (model.badge) {
    const badge = element('span', 'badge', BADGE_LABEL[model.badge])
    badge.id = 'badge'
    badge.dataset.badge = model.badge
    section.append(badge)
  }

  const time = element('div', 'time', model.timeText)
  time.id = 'time'
  section.append(time)

  if (model.titleText) {
    const title = element('div', 'title', model.titleText)
    title.id = 'title'
    section.append(title)
  }
  if (model.slideText) {
    const slide = element('div', 'slide', model.slideText)
    slide.id = 'slide'
    section.append(slide)
  }
  if (model.videoText) {
    const video = element('div', 'video', model.videoText)
    video.id = 'video'
    section.append(video)
  }
  if (model.messageText) {
    const message = element('div', 'message', model.messageText)
    message.id = 'message'
    section.append(message)
  }
  // Every slide video gets its own row beneath the large focus timer, with an
  // independent timer. Exactly one row is highlighted: the projection marks a
  // single `isFocus` tile, and that same tile backs the large timer above.
  if (model.videoRows.length > 0) {
    const list = element('ul', 'videos')
    list.id = 'videos'
    for (const row of model.videoRows) {
      const item = element('li', 'video-row')
      item.dataset.key = row.key
      item.dataset.ordinal = String(row.ordinal)
      if (row.isFocus) {
        item.classList.add('focus')
        item.dataset.focus = 'true'
      }
      item.append(element('span', 'video-row-name', row.label))
      const status = element('span', 'video-row-status', row.statusText)
      status.dataset.status = row.statusText.toLowerCase()
      item.append(status)
      item.append(element('span', 'video-row-time', row.timeText))
      list.append(item)
    }
    section.append(list)
  }
  if (model.multiInstanceWarning) {
    const warning = element('div', 'warning', model.multiInstanceWarning)
    warning.id = 'multi-instance'
    warning.setAttribute('role', 'alert')
    section.append(warning)
  }
  return section
}

function renderControls(view: AppView, dispatch: Dispatch): HTMLElement {
  const section = element('section', 'controls')

  const timing = element('div', 'timing-toggle')
  for (const mode of ['remaining', 'elapsed'] as const) {
    const button = element('button', 'toggle', mode === 'remaining' ? 'Remaining' : 'Elapsed')
    button.type = 'button'
    button.dataset.mode = mode
    if (view.timingMode === mode) button.classList.add('active')
    button.addEventListener('click', () => dispatch({ type: 'setTimingMode', mode }))
    timing.append(button)
  }
  section.append(timing)

  const alwaysOnTop = element('label', 'always-on-top', 'Always on top')
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.id = 'always-on-top'
  checkbox.checked = view.alwaysOnTop
  checkbox.addEventListener('change', () => dispatch({ type: 'setAlwaysOnTop', enabled: checkbox.checked }))
  alwaysOnTop.prepend(checkbox)
  section.append(alwaysOnTop)

  const presets = element('div', 'presets')
  for (const preset of ['compact', 'large'] as const) {
    const button = element('button', 'preset', preset === 'compact' ? 'Compact' : 'Large')
    button.type = 'button'
    button.dataset.preset = preset
    if (view.preset === preset) button.classList.add('active')
    button.addEventListener('click', () => dispatch({ type: 'applyPreset', preset }))
    presets.append(button)
  }
  section.append(presets)

  if (view.displays.length > 0) {
    const select = document.createElement('select')
    select.id = 'display-select'
    for (const display of view.displays) {
      const option = document.createElement('option')
      option.value = display.id
      option.textContent = display.label
      if (display.id === view.selectedDisplayId) option.selected = true
      select.append(option)
    }
    select.addEventListener('change', () => dispatch({ type: 'moveToDisplay', displayId: select.value }))
    section.append(select)
  }

  const copy = element('button', 'copy', 'Copy diagnostics')
  copy.type = 'button'
  copy.id = 'copy-diagnostics'
  copy.addEventListener('click', () => dispatch({ type: 'copyDiagnostics' }))
  section.append(copy)

  // The upsell CTA is omitted entirely when no exact HTTPS URL is configured
  // (S-033): no placeholder, no disabled dead control that resolves nowhere.
  if (view.ctaAvailable) {
    const cta = element('button', 'cta', 'Need full show control? Try OnTime')
    cta.type = 'button'
    cta.id = 'cta'
    cta.addEventListener('click', () => dispatch({ type: 'openUpsell' }))
    section.append(cta)
  }

  return section
}

/** Replace the app root with a fresh render of the immutable view (S-013). */
export function renderApp(root: HTMLElement, view: AppView, dispatch: Dispatch, advanceMs = 0): void {
  root.replaceChildren(renderStatus(view, advanceMs), renderControls(view, dispatch))
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
  /** Polite live region for status announcements; looked up by id by default. */
  announcer?: HTMLElement | null
}): () => void {
  const { root, api } = options
  const now = options.now ?? defaultNow
  const announcer =
    options.announcer ?? (typeof document !== 'undefined' ? document.getElementById('announcer') : null)
  const dispatch: Dispatch = (action) => {
    void api.dispatch(action)
  }
  // `revision` is monotonic; drop any view older than the last one rendered so a
  // late-resolving getView() cannot overwrite a newer pushed view and restore
  // stale timing after an `unavailable` transition (S-013). A dropped view also
  // leaves the observation anchor alone, so it cannot rewind newer timing.
  let lastRevision = -1
  let current: AppView | null = null
  let observedAt = 0
  let announced: string | null = null

  const render = (view: AppView): void => {
    if (view.revision < lastRevision) return
    lastRevision = view.revision
    current = view
    // Re-anchor on every accepted view: the render below shows the observed
    // measurement verbatim (advance 0), so a discontinuity snaps rather than
    // blending, and a new non-presentation state drops all timing anchors.
    observedAt = now()
    renderApp(root, view, dispatch)
    if (announcer) {
      const text = announcementFor(describeView(view.state, { timingMode: view.timingMode }))
      if (text !== announced) {
        announced = text
        announcer.textContent = text
      }
    }
  }

  const tick = (): void => {
    if (current === null) return
    patchTimers(root, current, localAdvanceMs(observedAt, now()))
  }

  const unsubscribe = api.subscribe(render)
  const ticker = setInterval(tick, SMOOTHING_TICK_MS)
  void api.getView().then(render)
  return () => {
    clearInterval(ticker)
    unsubscribe()
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app')
  if (root && window.ontime) mountApp({ root, api: window.ontime })
}
