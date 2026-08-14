import type { PresentationVideo } from './powerpoint-types'

export type PowerPointVideoStatus = 'ready' | 'playing' | 'paused' | 'ended'

/** End-inference threshold shared by status resolution and projection. */
export const POWERPOINT_END_INFER_MS = 250

/** Resolve one observed video to the canonical standalone display status. */
export function resolveVideoStatus(v: PresentationVideo): PowerPointVideoStatus {
  const inferredEnded =
    v.status === 'ended' ||
    (v.remaining !== undefined && v.remaining <= 0) ||
    (v.duration !== undefined && v.elapsed !== undefined && v.duration - v.elapsed <= POWERPOINT_END_INFER_MS)
  if (inferredEnded) return 'ended'
  if (v.status === 'playing' || v.playing === true) return 'playing'
  if (v.status === 'paused') return 'paused'
  if (v.elapsed !== undefined && v.elapsed > 0) return 'paused'
  return 'ready'
}
