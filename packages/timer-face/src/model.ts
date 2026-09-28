/**
 * Source-neutral compact timer display model (Deep Plan "Source-neutral face
 * extraction"). Adapters (local PowerPoint, remote PowerPoint, a future stage
 * timer) produce it; the face only renders it. No source, transport, or
 * platform types belong here.
 *
 * The rendered element IDs (#badge, #message, #time, #videos) are kept for
 * zero-diff adoption by the ISSUE-001 app and assume one face per document;
 * scope lookups to the face root (as `patchTimerFace` does).
 */

export type TimerConnection = 'connecting' | 'live' | 'stale' | 'disconnected' | 'ended' | 'unavailable'

export type TimerBadge = 'playing' | 'paused' | 'retry' | 'warning'

export type DisclosureRow = {
  /** Stable identity within one model. */
  key: string
  nameText: string
  statusText: string
  timeText: string
  /** Source-resolved headline row; semantic for adapters/consumers, not styled by the face. */
  isFocus: boolean
  /** Optional source position, rendered as `data-ordinal`. */
  ordinal?: number
  /** Screen-reader label; defaults to `nameText`. */
  announceLabel?: string
}

export type TimerDisplayModel = {
  connection: TimerConnection
  /** Large headline time. */
  timeText: string
  /** Small label above the time (badge text when `badge` is set). */
  statusText: string
  /** Announced status message; never rendered by the face. */
  messageText?: string
  badge?: TimerBadge
  disclosureRows: DisclosureRow[]
  /** `data-state` hook for adapter-specific states; defaults to `connection`. */
  stateKey?: string
  /** Announced before everything else (e.g. a source warning); never rendered. */
  alertText?: string
  /** Announced detail when there are no disclosure rows; never rendered. */
  announceDetail?: string
}
