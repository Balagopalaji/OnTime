/**
 * Per-video metadata entry inside a `LiveCue.metadata.videos[]` array.
 *
 * Shape mirrors `packages/shared-types/src/index.ts` `LiveCue.metadata.videos[]`
 * exactly (id?, name?, duration?, elapsed?, remaining?, playing?, status?).
 * presentation-core owns this entry shape so the merge rule is testable in
 * isolation without dragging in shared-types' full `LiveCue` definition.
 */
export type CueVideo = {
  id?: number
  name?: string
  duration?: number
  elapsed?: number
  remaining?: number
  playing?: boolean
  status?: 'playing' | 'paused' | 'ended'
}

/**
 * Merge the `videos[]` metadata of two live-cue records without flicker.
 *
 * Behavior (must stay byte-faithful with the historical closure in
 * `frontend/src/context/UnifiedDataContext.tsx`):
 *
 * - both records have empty `videos[]` -> return `incoming` unchanged
 * - `incoming.videos` empty, `existing.videos` non-empty -> KEEP `existing.videos`
 *   (this is the empty-overwrite bug fix pinned by docs/edge-cases.md §7;
 *    a newer record with no video metadata must not blank the UI)
 * - `existing.videos` empty, `incoming.videos` non-empty -> return `incoming`
 * - otherwise, per-video fallback merge: match by `id`, else by `name`; for
 *   each matched pair, the incoming field wins when present, otherwise the
 *   matched/existing field is preserved (`video.X ?? match.X`)
 *
 * Generic over the record so every non-video field passes through untouched
 * and the caller's full record type is preserved.
 */
export function mergeCueVideos<T extends { cue: { metadata?: { videos?: CueVideo[] } } }>(
  existing: T,
  incoming: T,
): T {
  const existingVideos = existing.cue.metadata?.videos ?? []
  const incomingVideos = incoming.cue.metadata?.videos ?? []
  if (incomingVideos.length === 0 && existingVideos.length === 0) return incoming
  if (incomingVideos.length === 0) {
    return {
      ...incoming,
      cue: {
        ...incoming.cue,
        metadata: {
          ...incoming.cue.metadata,
          videos: existingVideos,
        },
      },
    }
  }
  if (existingVideos.length === 0) return incoming
  const mergedVideos = incomingVideos.map((video) => {
    const match =
      existingVideos.find((entry) => entry.id !== undefined && entry.id === video.id) ??
      existingVideos.find((entry) => entry.name && entry.name === video.name)
    if (!match) return video
    return {
      ...match,
      ...video,
      id: video.id ?? match.id,
      name: video.name ?? match.name,
      duration: video.duration ?? match.duration,
      elapsed: video.elapsed ?? match.elapsed,
      remaining: video.remaining ?? match.remaining,
      playing: video.playing ?? match.playing,
      status: video.status ?? match.status,
    }
  })
  return {
    ...incoming,
    cue: {
      ...incoming.cue,
      metadata: {
        ...incoming.cue.metadata,
        videos: mergedVideos,
      },
    },
  }
}
