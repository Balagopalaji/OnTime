import { Link } from 'react-router-dom'
import type { LiveCue } from '../../types'
import { formatDuration } from '../../lib/time'

type PresentationStatusPanelProps = {
  cue: LiveCue | null
  isCapabilityMissing: boolean
  isMacPlatform: boolean
}

const buildSlideLabel = (cue: LiveCue) => {
  const slideNumber = cue.metadata?.slideNumber
  const totalSlides = cue.metadata?.totalSlides
  if (slideNumber === undefined && totalSlides === undefined) return null
  const current = slideNumber ?? '--'
  const total = totalSlides ?? '--'
  return `${current}/${total}`
}

export const PresentationStatusPanel = ({
  cue,
  isCapabilityMissing,
  isMacPlatform,
}: PresentationStatusPanelProps) => {
  const slideLabel = cue ? buildSlideLabel(cue) : null
  const videos = cue?.metadata?.videos ?? []
  const videoDurationMs = cue?.metadata?.videoDuration
  const videoElapsedMs = cue?.metadata?.videoElapsed
  const derivedRemaining =
    videoDurationMs !== undefined && videoElapsedMs !== undefined
      ? videoDurationMs - videoElapsedMs
      : null
  const timingUnavailable = Boolean(cue?.metadata?.videoTimingUnavailable)
  const videoRemainingMs =
    cue?.metadata?.videoRemaining ?? (derivedRemaining !== null ? derivedRemaining : null)
  const boundedRemainingMs = videoRemainingMs === null ? null : Math.max(0, videoRemainingMs)
  const progressRatio =
    videoDurationMs && boundedRemainingMs !== null
      ? Math.min(1, Math.max(0, 1 - boundedRemainingMs / videoDurationMs))
      : null
  const urgency =
    boundedRemainingMs !== null && boundedRemainingMs <= 10_000
      ? 'critical'
      : boundedRemainingMs !== null && boundedRemainingMs <= 30_000
        ? 'warning'
        : 'default'
  const urgencyText =
    urgency === 'critical'
      ? 'text-rose-200 animate-pulse'
      : urgency === 'warning'
        ? 'text-amber-200 animate-pulse'
        : 'text-slate-200'
  const urgencyBar =
    urgency === 'critical'
      ? 'bg-rose-400'
      : urgency === 'warning'
        ? 'bg-amber-300'
        : 'bg-emerald-400'
  const showVideoList = videos.length > 0

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-card">
      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Presentation status</p>
      {isCapabilityMissing ? (
        <div className="mt-3 rounded-xl border border-amber-800/50 bg-amber-950/40 px-3 py-3 text-xs text-amber-200">
          <p className="font-semibold">
            Feature unavailable in Minimal Mode — upgrade or restart Companion in Show Control mode.
          </p>
          <p className="mt-1 text-amber-100/80">
            Show Control mode is required for live presentation status.
          </p>
          <Link
            to="/local"
            className="mt-2 inline-flex rounded-full border border-amber-400/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-500/10"
          >
            Learn more
          </Link>
        </div>
      ) : !cue ? (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs text-slate-300">
          No presentation found.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
            <p className="text-sm font-semibold text-white">{cue.title || 'Presentation'}</p>
            {slideLabel ? (
              <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                <span className="uppercase tracking-[0.3em] text-slate-400">Slide</span>
                <span className="text-sm font-semibold text-white">{slideLabel}</span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">Slide data unavailable.</p>
            )}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">Video timing</p>
            {isMacPlatform ? (
              <p className="mt-2 text-xs text-slate-300">Video timing unavailable on macOS.</p>
            ) : timingUnavailable ? (
              <p className="mt-2 text-xs text-amber-200">
                Video timing unavailable. Continue without timing metadata.
              </p>
            ) : showVideoList ? (
              <div className="mt-2 space-y-2">
                {videos.map((video, index) => {
                  const label = video.name?.trim() || `Video ${index + 1}`
                  const remaining = video.remaining
                  const duration = video.duration
                  const value =
                    remaining !== undefined
                      ? formatDuration(Math.max(0, remaining))
                      : duration !== undefined
                        ? formatDuration(Math.max(0, duration))
                        : '--:--'
                  const badge = video.playing ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-800 text-slate-300'
                  return (
                    <div key={`${label}-${index}`} className="flex items-center justify-between text-xs text-slate-300">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100">{label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${badge}`}>
                          {video.playing ? 'Playing' : 'Ready'}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-white">{value}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-300">No video on this slide.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
