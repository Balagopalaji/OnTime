import type { TimerDisplayModel } from './model'

/**
 * Polite live-region text for a model. Built only from statuses, names, and
 * messages — never a timer value — so it changes on meaningful transitions
 * and stays silent through interpolation ticks. The alert (if any) leads.
 */
export function announcementFor(model: TimerDisplayModel): string {
  const head = model.messageText ?? (model.badge !== undefined ? model.statusText : undefined)
  const rows = model.disclosureRows
  const label = (index: number) => rows[index]?.announceLabel ?? rows[index]?.nameText
  const detail =
    rows.length > 1
      ? rows.map((row, index) => `${label(index)}: ${row.statusText}`).join(', ')
      : (label(0) ?? model.announceDetail)
  return [model.alertText, head, detail]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' — ')
}
