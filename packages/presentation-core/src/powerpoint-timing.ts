/**
 * Derive PowerPoint video time remaining when COM omitted that field.
 *
 * This belongs to the presentation domain rather than the general rundown
 * timer contract: video playback stops at its media duration and has no bonus
 * or overtime mode.
 */
export function derivePowerPointRemainingMs(
  durationMs: number | null | undefined,
  elapsedMs: number | null | undefined,
): number | null {
  const duration = typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : null
  const elapsed = typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) ? elapsedMs : null
  return duration !== null && elapsed !== null ? duration - elapsed : null
}
