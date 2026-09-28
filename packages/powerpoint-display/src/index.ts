import { formatTime, type DisclosureRow, type TimerDisplayModel } from '@ontime/timer-face'
import type {
  PowerPointPresentationState,
  PresentationPayloadView,
  RemoteVideoRowView,
  RemoteVideoStatus,
  ViewerProjection,
} from '@ontime/remote-viewer-contracts'

/**
 * Remote PowerPoint display adapter: the only bridge from a reduced viewer
 * projection to the source-neutral timer face. It never reselects a headline —
 * the host-marked focus row drives the large time — and it mirrors the local
 * ISSUE-001 copy so browser/desktop viewers match the Windows face. Its own
 * package keeps the server-trusted wire contracts free of any DOM/face
 * dependency.
 */

const DASHED = '--:--'

const STATUS_TEXT: Record<RemoteVideoStatus, string> = {
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Ended',
}

const UNAVAILABLE: Record<string, Pick<TimerDisplayModel, 'statusText' | 'messageText' | 'badge'>> = {
  'helper-unavailable': { statusText: 'Retrying', badge: 'retry', messageText: 'PowerPoint timing unavailable' },
  'no-presentation': { statusText: 'PowerPoint is not running', messageText: 'PowerPoint is not running' },
  'no-slideshow': { statusText: 'No slideshow running', messageText: 'No slideshow running' },
}

const STATE_COPY: Record<PowerPointPresentationState, Pick<TimerDisplayModel, 'statusText' | 'messageText' | 'badge'>> = {
  'no-video': { statusText: 'No video on this slide', messageText: 'No video on this slide' },
  'timing-unavailable': { statusText: 'Timing unavailable' },
  ready: { statusText: 'Ready', messageText: 'Ready' },
  playing: { statusText: 'Playing', badge: 'playing' },
  paused: { statusText: 'Paused', badge: 'paused' },
  ended: { statusText: 'Ended', messageText: 'Ended' },
}

const TERMINAL: Record<'connecting' | 'ended' | 'access-ended' | 'incompatible', TimerDisplayModel> = {
  connecting: { connection: 'connecting', statusText: 'Connecting', timeText: DASHED, messageText: 'Connecting to the show', disclosureRows: [] },
  ended: { connection: 'ended', stateKey: 'session-ended', statusText: 'Session ended', timeText: DASHED, messageText: 'This show has ended', disclosureRows: [] },
  'access-ended': { connection: 'ended', stateKey: 'access-ended', statusText: 'Access ended', timeText: DASHED, messageText: 'This viewer link is no longer valid', disclosureRows: [] },
  incompatible: {
    connection: 'unavailable',
    stateKey: 'incompatible',
    statusText: 'Update required',
    badge: 'warning',
    timeText: DASHED,
    messageText: 'This show uses a newer version; update the viewer',
    disclosureRows: [],
  },
}

/**
 * One row's time: a ready video shows its length in both modes (ISSUE-001
 * S-010 headline contract); an ended video shows 00:00 remaining / its final
 * elapsed; otherwise the current interpolated value, null as `--:--`.
 */
function rowTimeText(row: RemoteVideoRowView, timingMode: 'remaining' | 'elapsed'): string {
  if (row.status === 'ready') return formatTime(row.durationMs)
  if (timingMode === 'elapsed') return formatTime(row.status === 'ended' ? (row.elapsedMsNow ?? 0) : row.elapsedMsNow)
  return formatTime(row.status === 'ended' ? (row.remainingMsNow ?? 0) : row.remainingMsNow)
}

function presentationDisplay(payload: PresentationPayloadView, frozenTiming: boolean): Omit<TimerDisplayModel, 'connection'> {
  const timingMode = payload.headline.timingMode
  const suppressed = frozenTiming || payload.presentationState === 'timing-unavailable'
  const rows: DisclosureRow[] = payload.videos.map((row) => {
    const position = row.ordinal + 1
    const nameText = row.label ?? `Video ${position}`
    return {
      key: String(row.ordinal),
      ordinal: row.ordinal,
      nameText,
      statusText: STATUS_TEXT[row.status],
      timeText: suppressed ? DASHED : rowTimeText(row, timingMode),
      isFocus: row.isFocus,
      announceLabel: `${position}. ${nameText}`,
    }
  })
  const focus = payload.videos.find((row) => row.isFocus)
  const timeText =
    suppressed || payload.presentationState === 'no-video' || focus === undefined ? DASHED : rowTimeText(focus, timingMode)
  return { stateKey: payload.presentationState, ...STATE_COPY[payload.presentationState], timeText, disclosureRows: rows }
}

export function projectPowerPointDisplay(projection: ViewerProjection): TimerDisplayModel {
  if (!('availability' in projection)) return TERMINAL[projection.connection]
  const { connection, availability, payload } = projection
  let source: Omit<TimerDisplayModel, 'connection'>
  if (availability === 'connecting' || payload === null) {
    source = { stateKey: 'connecting', statusText: 'Connecting to PowerPoint', messageText: 'Connecting to PowerPoint…', timeText: DASHED, disclosureRows: [] }
  } else if (payload.reason !== 'presentation') {
    return { connection: 'unavailable', stateKey: payload.reason, ...UNAVAILABLE[payload.reason], timeText: DASHED, disclosureRows: [] }
  } else {
    source = presentationDisplay(payload, connection === 'disconnected')
  }
  if (connection === 'stale') {
    // The projection already froze interpolation at the stale boundary; say so rather than "Playing".
    return { ...source, connection, statusText: 'Reconnecting', badge: 'warning', messageText: 'Connection stale; showing the last update' }
  }
  if (connection === 'disconnected') {
    return { ...source, connection, statusText: 'Disconnected', badge: 'warning', messageText: 'Disconnected from the show', timeText: DASHED }
  }
  return { ...source, connection }
}
