/**
 * Pure renderer view model (ISSUE-001 H5). Maps a projected
 * `PowerPointViewState` (produced by `@ontime/presentation-core` in the main
 * process) to exact display strings. No Electron, no Node, no clock, no
 * extrapolation — it only formats the most recently observed measurement
 * (S-017) and never advances time on its own.
 *
 * The renderer receives an already-projected view via IPC; this module owns the
 * last mile of human-readable formatting (state copy, slide position, video
 * indicator, multi-instance overlay, and `--:--` / `00:00` time rendering).
 */
import type { PowerPointViewState } from '@ontime/presentation-core'

export type Badge = 'playing' | 'paused' | 'retry'

export type RenderModel = {
  stateKind: PowerPointViewState['kind']
  badge: Badge | null
  titleText: string
  slideText: string | null
  videoText: string | null
  timeText: string
  messageText: string | null
  multiInstanceWarning: string | null
}

const DASHED = '--:--'
const MULTI_INSTANCE_WARNING = 'Multiple PowerPoint instances detected; verify the deck'

/**
 * Format a millisecond value as `MM:SS` (or `H:MM:SS` at/above one hour). A null
 * or non-finite value renders `--:--`; zero renders `00:00`. Values are rounded
 * to the nearest second and never displayed negative.
 */
export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return DASHED
  const seconds = Math.round(ms / 1000)
  const safe = seconds < 0 ? 0 : seconds
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function slideLabel(state: PowerPointViewState): string | null {
  if (state.kind === 'connecting' || state.kind === 'unavailable' || state.kind === 'powerpoint_not_running' || state.kind === 'no_slideshow') {
    return null
  }
  if (state.slideNumber === undefined) return null
  const total = state.totalSlides ?? '--'
  return `Slide ${state.slideNumber} of ${total}`
}

function titleLabel(state: PowerPointViewState): string {
  if (state.kind === 'connecting' || state.kind === 'unavailable' || state.kind === 'powerpoint_not_running' || state.kind === 'no_slideshow') {
    return ''
  }
  // Projection already basename-trims filename (S-016); title is the deck name.
  return state.title || state.filenameBasename || ''
}

function videoLabel(state: PowerPointViewState): string | null {
  if (state.kind === 'connecting' || state.kind === 'unavailable' || state.kind === 'powerpoint_not_running' || state.kind === 'no_slideshow' || state.kind === 'no_video') {
    return null
  }
  if (state.multipleVideos) return `${state.videoCount} videos`
  return state.selectedVideoName ?? null
}

/**
 * Project a view state to an immutable render model with exact display strings.
 * An `unavailable` state produces `timeText: '--:--'` with no stale number, so a
 * single renderer repaint removes visible timing (S-013).
 */
export function describeView(state: PowerPointViewState): RenderModel {
  const base = {
    stateKind: state.kind,
    badge: null as Badge | null,
    titleText: titleLabel(state),
    slideText: slideLabel(state),
    videoText: videoLabel(state),
    timeText: DASHED,
    messageText: null as string | null,
    multiInstanceWarning: state.multipleInstanceWarning ? MULTI_INSTANCE_WARNING : null,
  }

  switch (state.kind) {
    case 'connecting':
      return { ...base, messageText: 'Connecting to PowerPoint…' }
    case 'unavailable':
      return { ...base, badge: 'retry', messageText: 'PowerPoint timing unavailable' }
    case 'powerpoint_not_running':
      return { ...base, messageText: 'PowerPoint is not running' }
    case 'no_slideshow':
      return { ...base, messageText: 'No slideshow running' }
    case 'no_video':
      return { ...base, messageText: 'No video on this slide' }
    case 'timing_unavailable':
      return { ...base }
    case 'playing':
      return { ...base, badge: 'playing', timeText: formatTime(state.timeMs) }
    case 'paused':
      return { ...base, badge: 'paused', timeText: formatTime(state.timeMs) }
    case 'ended':
      return { ...base, messageText: 'Ended', timeText: formatTime(state.timeMs) }
    case 'ready':
      return { ...base, messageText: 'Ready', timeText: state.durationMs !== null ? formatTime(state.durationMs) : DASHED }
    default:
      return { ...base }
  }
}
