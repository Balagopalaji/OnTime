/**
 * Pure DOM rendering for the compact PowerPoint panel. The component consumes
 * only the transport-neutral {@link RenderModel}; Electron window controls,
 * IPC, probing, and networking remain in their host adapters.
 */
import type { Badge, RenderModel, VideoRowModel } from './view.js'

const BADGE_LABEL: Record<Badge, string> = {
  playing: 'Playing',
  paused: 'Paused',
  retry: 'Retrying',
}

const STATE_LABEL: Partial<Record<RenderModel['stateKind'], string>> = {
  connecting: 'Connecting to PowerPoint',
  powerpoint_not_running: 'PowerPoint is not running',
  no_slideshow: 'No slideshow running',
  no_video: 'No video on this slide',
  timing_unavailable: 'Timing unavailable',
  ready: 'Ready',
  ended: 'Ended',
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Approximate the rendered width of a tabular timer string in `em` units.
 * Digits are wider than separators in Segoe UI, so using the raw character
 * count would make `00:00` unnecessarily small and could still clip
 * `1:00:00`. The result is converted to a container-width value consumed by
 * CSS; height remains the other fitting constraint.
 */
export function timerFitWidthCqw(text: string): number {
  let units = 0
  for (const character of text) {
    if (character >= '0' && character <= '9') units += 0.56
    else if (character === ':') units += 0.25
    else units += 0.5
  }
  return Math.round((94 / Math.max(units, 1)) * 100) / 100
}

/** Keep text and its responsive width constraint synchronized. */
export function setTimerText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
  const fitWidth = `${timerFitWidthCqw(text)}cqw`
  if (node.style.getPropertyValue('--time-fit-width') !== fitWidth) {
    node.style.setProperty('--time-fit-width', fitWidth)
  }
}

/** Render the always-visible focused timer surface. */
export function renderPowerPointPanel(model: RenderModel): HTMLElement {
  const section = element('section', 'status')
  section.dataset.state = model.stateKind
  let label: HTMLElement
  if (model.badge) {
    label = element('span', 'status-label badge', BADGE_LABEL[model.badge])
    label.id = 'badge'
    label.dataset.badge = model.badge
  } else {
    label = element('span', 'status-label message', STATE_LABEL[model.stateKind] ?? model.messageText ?? 'PowerPoint timer')
    label.id = 'message'
  }
  const stack = element('div', 'timer-stack')
  stack.append(label)
  const time = element('div', 'time')
  time.id = 'time'
  setTimerText(time, model.timeText)
  stack.append(time)
  section.append(stack)
  return section
}

/** Render drawer-only video rows; callers decide which rows are secondary. */
export function renderVideoList(rows: VideoRowModel[]): HTMLElement | null {
  if (rows.length === 0) return null
  const list = element('ul', 'videos')
  list.id = 'videos'
  for (const row of rows) {
    const item = element('li', 'video-row')
    item.dataset.key = row.key
    item.dataset.ordinal = String(row.ordinal)
    item.append(element('span', 'video-row-name', row.nameText))
    const status = element('span', 'video-row-status', row.statusText)
    status.dataset.status = row.statusText.toLowerCase()
    item.append(status)
    item.append(element('span', 'video-row-time', row.timeText))
    list.append(item)
  }
  return list
}
