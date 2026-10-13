/** Capped exponential backoff with jitter for sidecar cloud calls (1 s, 2 s, 4 s … 30 s; × [0.5, 1]). */
export const RETRY_BASE_MS = 1_000
export const RETRY_CAP_MS = 30_000

export function retryDelayMs(attempt: number, random: number): number {
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (Math.max(1, attempt) - 1))
  return Math.round(base * (0.5 + random / 2))
}
