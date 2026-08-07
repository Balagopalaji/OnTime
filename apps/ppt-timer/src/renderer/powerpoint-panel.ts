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
  const focus = model.videoRows.find((row) => row.isFocus)
  const identity = element('div', 'focus-identity')

  if (model.badge) {
    const badge = element('span', 'badge', BADGE_LABEL[model.badge])
    badge.id = 'badge'
    badge.dataset.badge = model.badge
    identity.append(badge)
  }
  if (focus || model.videoText) {
    const video = element('div', 'video', focus?.nameText ?? model.videoText ?? '')
    video.id = 'video'
    identity.append(video)
  }
  if (identity.childElementCount > 0) section.append(identity)

  const time = element('div', 'time', model.timeText)
  time.id = 'time'
  section.append(time)

  if (model.titleText || model.slideText) {
    const context = element('div', 'presentation-context')
    if (model.titleText) {
      const title = element('div', 'title', model.titleText)
      title.id = 'title'
      context.append(title)
    }
    if (model.slideText) {
      const slide = element('div', 'slide', model.slideText)
      slide.id = 'slide'
      context.append(slide)
    }
    section.append(context)
  }
  if (model.messageText) {
    const message = element('div', 'message', model.messageText)
    message.id = 'message'
    section.append(message)
  }
  if (model.multiInstanceWarning) {
    // Announced once through the separate polite live region, not this node.
    const warning = element('div', 'warning', model.multiInstanceWarning)
    warning.id = 'multi-instance'
    section.append(warning)
  }
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
