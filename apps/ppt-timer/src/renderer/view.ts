/**
 * Pure renderer view model (ISSUE-001 H5). Maps a projected
 * `PowerPointViewState` (produced by `@ontime/presentation-core` in the main
 * process) to exact display strings. No Electron, no Node, no clock: the
 * projection/core stays clock-free (S-017) and this module never reads time
 * itself — a caller-supplied `advanceMs` (already bounded by
 * {@link localAdvanceMs}) is the ONLY smoothing input, so every function here
 * stays pure and deterministic.
 *
 * The renderer receives an already-projected view via IPC; this module owns the
 * last mile of human-readable formatting (state copy, slide position, video
 * indicator, per-video rows, multi-instance overlay, `--:--` / `00:00` time
 * rendering) plus the bounded local interpolation between helper observations.
 */
import type {
  PowerPointTimingMode,
  PowerPointVideoTile,
  PowerPointViewPresentation,
  PowerPointViewState,
  PowerPointViewStateBase,
} from '@ontime/presentation-core'

export type Badge = 'playing' | 'paused' | 'retry'

/** One row per slide video, rendered beneath the large focus timer. */
export type VideoRowModel = {
  /** Stable within a view: the tile's zero-based shape ordinal, stringified. */
  key: string
  ordinal: number
  /** `"1. Intro.mp4"` — ordinal plus name, with a `Video N` name fallback. */
  label: string
  statusText: 'Ready' | 'Playing' | 'Paused' | 'Ended'
  timeText: string
  isFocus: boolean
}

export type RenderModel = {
  stateKind: PowerPointViewState['kind']
  badge: Badge | null
  titleText: string
  slideText: string | null
  videoText: string | null
  timeText: string
  messageText: string | null
  videoRows: VideoRowModel[]
  multiInstanceWarning: string | null
}

export type DescribeViewOptions = {
  /** Which scalar the large timer and every row render. Defaults to remaining. */
  timingMode?: PowerPointTimingMode
  /**
   * Milliseconds of bounded local advance to apply to rows observed `playing`.
   * Zero (the default) renders the observed measurement verbatim. Callers get
   * this from {@link localAdvanceMs}; values <= 0 never advance anything.
   */
  advanceMs?: number
}

const DASHED = '--:--'
const MULTI_INSTANCE_WARNING = 'Multiple PowerPoint instances detected; verify the deck'

/**
 * Hard cap on local interpolation. After this long without a fresh helper
 * observation the display freezes at the last locally-advanced value rather
 * than counting indefinitely; the frozen row keeps its observed status (no
 * invented `Paused` or `Ended`).
 */
export const SMOOTHING_STALE_MS = 2_000

/** Local repaint cadence for the interpolation tick (timer text only). */
export const SMOOTHING_TICK_MS = 250

const STATUS_TEXT: Record<PowerPointVideoTile['status'], VideoRowModel['statusText']> = {
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Ended',
}

/**
 * Format a millisecond value as `MM:SS` (or `H:MM:SS` at/above one hour). A null
 * or non-finite value renders `--:--`; zero renders `00:00`. Values are floored
 * to whole seconds (matching the Controller's `formatDuration`, so the same
 * measurement never reads one second apart across surfaces) and are never
 * displayed negative.
 */
export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return DASHED
  const seconds = Math.floor(ms / 1000)
  const safe = seconds < 0 ? 0 : seconds
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Bounded elapsed time since a view was observed locally, in milliseconds.
 * Clamped to `[0, SMOOTHING_STALE_MS]`: a clock that went backwards yields 0
 * (the observed truth) and a stalled helper freezes rather than counting on.
 */
export function localAdvanceMs(observedAt: number, now: number): number {
  if (!Number.isFinite(observedAt) || !Number.isFinite(now)) return 0
  const delta = now - observedAt
  if (delta <= 0) return 0
  return delta > SMOOTHING_STALE_MS ? SMOOTHING_STALE_MS : delta
}

type PresentationView = PowerPointViewStateBase & PowerPointViewPresentation

/** True for the presentation variants — the only ones carrying deck/`videos` data. */
function isPresentation(state: PowerPointViewState): state is PresentationView {
  return (
    state.kind !== 'connecting' &&
    state.kind !== 'unavailable' &&
    state.kind !== 'powerpoint_not_running' &&
    state.kind !== 'no_slideshow'
  )
}

function finite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

/**
 * A row's remaining value: the observed remaining, or `duration - elapsed` only
 * when no remaining was observed. Never negative-clamped here — formatting
 * clamps at display so a bonus/overrun value still floors to `00:00`.
 */
export function tileRemainingMs(tile: PowerPointVideoTile): number | null {
  const observed = finite(tile.remainingMs)
  if (observed !== null) return observed
  const duration = finite(tile.durationMs)
  const elapsed = finite(tile.elapsedMs)
  return duration !== null && elapsed !== null ? duration - elapsed : null
}

/**
 * Advance one row by `advanceMs` of local time. Only a row observed `playing`
 * moves: remaining decrements toward zero, elapsed increments toward duration,
 * and both are capped there. `ready`, `paused`, and `ended` rows are returned
 * untouched, and the status is NEVER rewritten — a playing row may reach
 * `00:00` locally while still reading `Playing` until the helper confirms
 * `Ended`.
 */
function advanceTile(tile: PowerPointVideoTile, advanceMs: number): PowerPointVideoTile {
  if (!(advanceMs > 0) || tile.status !== 'playing') return tile
  const duration = finite(tile.durationMs)
  const remaining = tileRemainingMs(tile)
  const elapsed = finite(tile.elapsedMs)
  const nextRemaining = remaining === null ? tile.remainingMs : Math.max(0, remaining - advanceMs)
  const nextElapsed =
    elapsed === null
      ? tile.elapsedMs
      : duration === null
        ? elapsed + advanceMs
        : Math.min(duration, elapsed + advanceMs)
  return { ...tile, remainingMs: nextRemaining, elapsedMs: nextElapsed }
}

/**
 * The one time string for a row, and (via the focus row) for the large timer.
 * Both surfaces call this with the SAME tile, so they can never disagree.
 * - `ready`: the duration, in BOTH timing modes. Deliberate: this is the
 *   pre-existing S-010 headline contract, and a ready video's meaningful number
 *   is its length, not a zero. It does mean the row column can show a duration
 *   beside an elapsed value in elapsed mode; returning `00:00` instead would
 *   change S-010 copy and break the focus-row/large-timer alignment invariant,
 *   so the mixed unit is the accepted trade. Pinned by a two-mode test.
 * - `ended`: `00:00` remaining / the final elapsed, matching the projection.
 * - otherwise: the row's own remaining or elapsed value; null renders `--:--`.
 */
function tileTimeText(tile: PowerPointVideoTile, timingMode: PowerPointTimingMode): string {
  if (tile.status === 'ready') return formatTime(finite(tile.durationMs))
  if (timingMode === 'elapsed') {
    return formatTime(tile.status === 'ended' ? (finite(tile.elapsedMs) ?? 0) : finite(tile.elapsedMs))
  }
  return formatTime(tile.status === 'ended' ? (tileRemainingMs(tile) ?? 0) : tileRemainingMs(tile))
}

function rowLabel(tile: PowerPointVideoTile): string {
  const position = tile.ordinal + 1
  const name = tile.name?.trim()
  return `${position}. ${name !== undefined && name.length > 0 ? name : `Video ${position}`}`
}

function slideLabel(state: PowerPointViewState): string | null {
  if (!isPresentation(state)) return null
  if (state.slideNumber === undefined) return null
  const total = state.totalSlides ?? '--'
  return `Slide ${state.slideNumber} of ${total}`
}

function titleLabel(state: PowerPointViewState): string {
  if (!isPresentation(state)) return ''
  // Projection already basename-trims filename (S-016); title is the deck name.
  return state.title || state.filenameBasename || ''
}

function videoLabel(state: PowerPointViewState): string | null {
  if (!isPresentation(state) || state.kind === 'no_video') return null
  if (state.multipleVideos) return `${state.videoCount} videos`
  return state.selectedVideoName ?? null
}

/**
 * Project a view state to an immutable render model with exact display strings.
 * An `unavailable` state produces `timeText: '--:--'` with no stale number and
 * no rows, so a single renderer repaint removes visible timing (S-013).
 *
 * The large timer is derived from the focus row itself — never from a separate
 * helper-primary scalar — so the highlighted row and the headline number always
 * show the same measurement. `state.timeMs` remains the fallback only for a
 * projection that carried no rows at all.
 */
export function describeView(state: PowerPointViewState, options: DescribeViewOptions = {}): RenderModel {
  const timingMode = options.timingMode ?? 'remaining'
  // `timing_unavailable` means the helper could not read media timing for this
  // slide, yet the per-video array can still carry values from an EARLIER
  // observation: normalization falls back to the cached/prior video list while
  // setting `videoTimingUnavailable` independently of it. Numeric row timing is
  // therefore suppressed (and never advanced) in that state, so the rows agree
  // with the `--:--` headline instead of counting down from stale data.
  const timingSuppressed = state.kind === 'timing_unavailable'
  const advanceMs = timingSuppressed ? 0 : (options.advanceMs ?? 0)
  const tiles: PowerPointVideoTile[] = isPresentation(state)
    ? state.videos.map((tile) => advanceTile(tile, advanceMs))
    : []
  const focus = tiles.find((tile) => tile.isFocus)

  const base = {
    stateKind: state.kind,
    badge: null as Badge | null,
    titleText: titleLabel(state),
    slideText: slideLabel(state),
    videoText: videoLabel(state),
    timeText: DASHED,
    messageText: null as string | null,
    videoRows: tiles.map((tile) => ({
      key: String(tile.ordinal),
      ordinal: tile.ordinal,
      label: rowLabel(tile),
      statusText: STATUS_TEXT[tile.status],
      timeText: timingSuppressed ? DASHED : tileTimeText(tile, timingMode),
      isFocus: tile.isFocus,
    })),
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
      return { ...base, badge: 'playing', timeText: focus ? tileTimeText(focus, timingMode) : formatTime(state.timeMs) }
    case 'paused':
      return { ...base, badge: 'paused', timeText: focus ? tileTimeText(focus, timingMode) : formatTime(state.timeMs) }
    case 'ended':
      return {
        ...base,
        messageText: 'Ended',
        timeText: focus ? tileTimeText(focus, timingMode) : formatTime(state.timeMs),
      }
    case 'ready':
      return {
        ...base,
        messageText: 'Ready',
        timeText: focus
          ? tileTimeText(focus, timingMode)
          : state.durationMs !== null
            ? formatTime(state.durationMs)
            : DASHED,
      }
    default:
      return { ...base }
  }
}

/**
 * The text a screen reader should hear for a view. Derived only from statuses,
 * names, and messages — never from a timer value — so the polite live region
 * announces meaningful changes (a video starting, pausing, or ending) and stays
 * silent through the 250 ms interpolation ticks.
 *
 * The multi-instance warning leads the string when present. It used to announce
 * itself through a `role="alert"` node, which the full repaint re-inserted on
 * every poll and so re-announced assertively once per second for the whole
 * session; routing it here means it is spoken once, when it appears.
 */
export function announcementFor(model: RenderModel): string {
  const badgeStatus =
    model.badge === 'playing' ? 'Playing' : model.badge === 'paused' ? 'Paused' : model.badge === 'retry' ? 'Retrying' : null
  const head = model.messageText ?? badgeStatus
  const rows = model.videoRows
  const detail =
    rows.length > 1
      ? rows.map((row) => `${row.label}: ${row.statusText}`).join(', ')
      : (rows[0]?.label ?? model.videoText)
  return [model.multiInstanceWarning, head, detail]
    .filter((part): part is string => part !== null && part !== undefined && part.length > 0)
    .join(' — ')
}

/**
 * Identity of the MEASUREMENT a view carries: state kind, slide, and every
 * row's identity plus observed timing. Two views with the same signature carry
 * the same observation, however they were delivered.
 *
 * The renderer anchors local interpolation on this rather than on delivery,
 * because a push is not proof of a fresh reading. Two real paths re-deliver an
 * unchanged measurement: a display-list change pushes the view WITHOUT
 * incrementing the revision, and a dropped/partial poll produces a NEW revision
 * whose timing normalization re-emitted from the prior snapshot. Re-anchoring on
 * either one snaps the display back to the older value — a visible rewind, the
 * exact artefact the smoothing exists to remove.
 */
export function timingSignature(state: PowerPointViewState): string {
  if (!isPresentation(state)) return state.kind
  const rows = state.videos
    .map((tile) =>
      [tile.ordinal, tile.id ?? '', tile.status, tile.durationMs ?? '', tile.elapsedMs ?? '', tile.remainingMs ?? '', tile.isFocus ? 1 : 0].join(
        '|',
      ),
    )
    .join(';')
  return [state.kind, state.slideNumber ?? '', state.timeMs ?? '', state.durationMs ?? '', rows].join('~')
}
