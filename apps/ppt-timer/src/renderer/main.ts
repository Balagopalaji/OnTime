/**
 * Plain renderer entry (ISSUE-001 H5, S-014/S-017/S-033). No Node, no Electron,
 * no framework, no remote content: it renders the immutable {@link AppView}
 * pushed from the main process and sends closed-union {@link RendererAction}s
 * back through the sandboxed preload bridge. All display formatting is delegated
 * to `describeView`, which only renders the latest measurement and never
 * advances time locally (S-017). User-derived strings go through `textContent`,
 * never `innerHTML`, so a deck name can never inject markup.
 */
import { describeView, type Badge } from './view.js'
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

function renderStatus(state: AppView['state']): HTMLElement {
  const model = describeView(state)
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
    const cta = element('button', 'cta', 'Get OnTime')
    cta.type = 'button'
    cta.id = 'cta'
    cta.addEventListener('click', () => dispatch({ type: 'openUpsell' }))
    section.append(cta)
  }

  return section
}

/** Replace the app root with a fresh render of the immutable view (S-013). */
export function renderApp(root: HTMLElement, view: AppView, dispatch: Dispatch): void {
  root.replaceChildren(renderStatus(view.state), renderControls(view, dispatch))
}

/** Wire the preload bridge: subscribe to pushes and render the initial view. */
export function mountApp(options: { root: HTMLElement; api: PreloadApi }): () => void {
  const { root, api } = options
  const dispatch: Dispatch = (action) => {
    void api.dispatch(action)
  }
  // `revision` is monotonic; drop any view older than the last one rendered so a
  // late-resolving getView() cannot overwrite a newer pushed view and restore
  // stale timing after an `unavailable` transition (S-013).
  let lastRevision = -1
  const render = (view: AppView): void => {
    if (view.revision < lastRevision) return
    lastRevision = view.revision
    renderApp(root, view, dispatch)
  }
  const unsubscribe = api.subscribe(render)
  void api.getView().then(render)
  return unsubscribe
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('app')
  if (root && window.ontime) mountApp({ root, api: window.ontime })
}
