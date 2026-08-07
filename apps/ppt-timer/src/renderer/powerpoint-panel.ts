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
  section.append(label)

  const time = element('div', 'time', model.timeText)
  time.id = 'time'
  section.append(time)
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
