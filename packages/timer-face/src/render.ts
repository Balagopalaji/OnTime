import type { DisclosureRow, TimerDisplayModel } from './model'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Approximate the rendered width of a tabular timer string in `em` units
 * (digits are wider than separators) and convert it to the container-width
 * value the `.time` rule consumes; height is the other fitting constraint.
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

/** Keep timer text and its responsive width constraint synchronized. */
export function setTimerText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
  const fitWidth = `${timerFitWidthCqw(text)}cqw`
  if (node.style.getPropertyValue('--time-fit-width') !== fitWidth) {
    node.style.setProperty('--time-fit-width', fitWidth)
  }
}

/** The always-visible compact face: a small status label above the large time. */
export function renderTimerFace(model: TimerDisplayModel): HTMLElement {
  const section = element('section', 'status')
  section.dataset.state = model.stateKey ?? model.connection
  // Freshness has its own hook so a source stateKey can never hide it.
  if (model.connection === 'stale' || model.connection === 'disconnected') section.dataset.connection = model.connection
  let label: HTMLElement
  if (model.badge) {
    label = element('span', 'status-label badge', model.statusText)
    label.id = 'badge'
    label.dataset.badge = model.badge
  } else {
    label = element('span', 'status-label message', model.statusText)
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

/** Disclosure rows (name, status, time); callers decide where the list lives. */
export function renderDisclosureList(rows: DisclosureRow[]): HTMLElement | null {
  if (rows.length === 0) return null
  const list = element('ul', 'videos')
  list.id = 'videos'
  for (const row of rows) {
    const item = element('li', 'video-row')
    item.dataset.key = row.key
    if (row.ordinal !== undefined) item.dataset.ordinal = String(row.ordinal)
    item.append(element('span', 'video-row-name', row.nameText))
    const status = element('span', 'video-row-status', row.statusText)
    status.dataset.status = row.statusText.toLowerCase()
    item.append(status)
    item.append(element('span', 'video-row-time', row.timeText))
    list.append(item)
  }
  return list
}

/**
 * Patch ONLY the headline and row time strings of an already-rendered face, so
 * interpolation ticks recreate no node, rebind nothing, and never touch the
 * status/announcement copy.
 */
export function patchTimerFace(root: ParentNode, model: TimerDisplayModel): void {
  const time = root.querySelector('#time')
  if (time instanceof HTMLElement) setTimerText(time, model.timeText)
  const rowTimes = root.querySelectorAll('.video-row .video-row-time')
  model.disclosureRows.forEach((row, index) => {
    const node = rowTimes[index]
    if (node && node.textContent !== row.timeText) node.textContent = row.timeText
  })
}
