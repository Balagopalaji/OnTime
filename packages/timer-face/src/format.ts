const DASHED = '--:--'

/**
 * Format milliseconds as `MM:SS` (or `H:MM:SS` from one hour). Null or
 * non-finite renders `--:--`; values floor to whole seconds and never display
 * negative.
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
