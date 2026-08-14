import type { AppView, RendererAction } from '../shared/ipc-contract.js'

type Dispatch = (action: RendererAction) => void

function button(id: string, className: string, text: string, title: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.id = id
  node.className = className
  node.textContent = text
  node.title = title
  node.setAttribute('aria-label', title)
  return node
}

function pressedToggle(
  id: string,
  text: string,
  title: string,
  pressed: boolean,
  onChange: (enabled: boolean) => void,
): HTMLButtonElement {
  const node = button(id, 'option-button', text, title)
  node.setAttribute('aria-pressed', String(pressed))
  node.addEventListener('click', () => {
    const enabled = node.getAttribute('aria-pressed') !== 'true'
    node.setAttribute('aria-pressed', String(enabled))
    onChange(enabled)
  })
  return node
}

/** Render the compact, transport-neutral stage-two operational controls. */
export function renderOptionStrip(view: AppView, dispatch: Dispatch): HTMLElement {
  const strip = document.createElement('div')
  strip.className = 'option-strip'
  const nextMode = view.timingMode === 'remaining' ? 'elapsed' : 'remaining'
  const timing = button('timing-mode', 'option-button timing-mode', view.timingMode === 'remaining' ? 'Remaining' : 'Elapsed', `Show ${nextMode} time`)
  timing.dataset.mode = view.timingMode
  timing.addEventListener('click', () => dispatch({ type: 'setTimingMode', mode: timing.dataset.mode === 'elapsed' ? 'remaining' : 'elapsed' }))
  const nextHeadline = view.headlineMode === 'longest-remaining' ? 'latest-started' : 'longest-remaining'
  const headline = button(
    'headline-mode',
    'option-button headline-mode',
    view.headlineMode === 'longest-remaining' ? 'Longest' : 'Latest',
    nextHeadline === 'latest-started' ? 'Follow the latest-started playing video' : 'Show time until all playing videos finish',
  )
  headline.dataset.mode = view.headlineMode
  headline.addEventListener('click', () => dispatch({
    type: 'setHeadlineMode',
    mode: headline.dataset.mode === 'latest-started' ? 'longest-remaining' : 'latest-started',
  }))
  const onTop = pressedToggle('always-on-top', 'On top', 'Always on top', view.alwaysOnTop, (enabled) => dispatch({ type: 'setAlwaysOnTop', enabled }))
  onTop.classList.add('always-on-top')
  const autoOpen = pressedToggle(
    'auto-open-video-list',
    'Auto open',
    'Automatically open the video list on slides with multiple videos',
    view.autoOpenVideoList,
    (enabled) => dispatch({ type: 'setAutoOpenVideoList', enabled }),
  )
  const diagnostics = button('copy-diagnostics', 'option-button', 'Diagnostics', 'Copy diagnostics')
  diagnostics.addEventListener('click', () => dispatch({ type: 'copyDiagnostics' }))
  strip.append(timing, headline, onTop, autoOpen, diagnostics)
  return strip
}

/** Window chrome stays available independently of either tray stage. */
export function renderWindowControls(dispatch: Dispatch): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'window-controls'
  controls.setAttribute('role', 'group')
  controls.setAttribute('aria-label', 'Window controls')
  const minimize = button('minimize-window', 'window-control-button', '—', 'Minimize window')
  minimize.addEventListener('click', () => dispatch({ type: 'minimizeWindow' }))
  const close = button('close-window', 'window-control-button close-window', '×', 'Close window')
  close.addEventListener('click', () => dispatch({ type: 'closeWindow' }))
  controls.append(minimize, close)
  return controls
}
