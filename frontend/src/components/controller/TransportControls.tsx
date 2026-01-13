import { useCallback, useEffect, useRef } from 'react'
import { Clock3, Minus, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { Tooltip } from '../core/Tooltip'

export const TransportControls = ({
  isRunning,
  onStart,
  onPause,
  onReset,
  onNudge,
  onToggleClock,
  showClock,
  disableActions = false,
  readOnly = false,
}: {
  isRunning: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onNudge: (deltaMs: number) => void
  onToggleClock?: () => void
  showClock?: boolean
  disableActions?: boolean
  readOnly?: boolean
}) => {
  const holdRef = useRef<number | null>(null)
  const holdDirectionRef = useRef<-1 | 1>(1)
  const holdingRef = useRef(false)
  const holdAccumRef = useRef(0)

  const stopHold = useCallback(() => {
    if (holdRef.current) window.clearTimeout(holdRef.current)
    holdRef.current = null
    holdingRef.current = false
    holdAccumRef.current = 0
  }, [])

  const scheduleHoldTick = useCallback(function tick() {
      if (!holdingRef.current) return
      const step = holdAccumRef.current >= 30 ? 10 : 1
      holdAccumRef.current += step
      onNudge(step * 60_000 * holdDirectionRef.current)
      const nextDelay = holdAccumRef.current >= 30 ? 140 : 200
      holdRef.current = window.setTimeout(tick, nextDelay)
    }, [onNudge])

  const startHold = useCallback(
    (direction: -1 | 1) => {
      if (disableActions) return
      stopHold()
      holdingRef.current = true
      holdDirectionRef.current = direction
      holdAccumRef.current = 1
      onNudge(direction * 60_000)
      holdRef.current = window.setTimeout(scheduleHoldTick, 250)
    },
    [disableActions, onNudge, scheduleHoldTick, stopHold],
  )

  useEffect(() => {
    const handleUp = () => stopHold()
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [stopHold])

  const blockedClass = readOnly ? 'cursor-not-allowed' : ''

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content="Start Timer">
        <button
          type="button"
          onClick={onStart}
          aria-disabled={readOnly}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/90 text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40 ${blockedClass}`}
          disabled={disableActions || isRunning}
        >
          <Play size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Pause Timer">
        <button
          type="button"
          onClick={onPause}
          aria-disabled={readOnly}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-white transition hover:border-white/70 disabled:opacity-40 ${blockedClass}`}
          disabled={disableActions || !isRunning}
        >
          <Pause size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Remove 1 minute (hold to repeat)">
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            startHold(-1)
          }}
          onPointerUp={stopHold}
          aria-disabled={readOnly}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40 ${blockedClass}`}
          disabled={disableActions}
          aria-label="Remove time"
          style={{ touchAction: 'none' }}
        >
          <Minus size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Add 1 minute (hold to repeat)">
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture?.(event.pointerId)
            startHold(1)
          }}
          onPointerUp={stopHold}
          aria-disabled={readOnly}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200 transition hover:border-white/70 disabled:opacity-40 ${blockedClass}`}
          disabled={disableActions}
          aria-label="Add time"
          style={{ touchAction: 'none' }}
        >
          <Plus size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Reset Timer">
        <button
          type="button"
          onClick={onReset}
          aria-disabled={readOnly}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-500/50 text-rose-200 transition hover:border-rose-200 disabled:opacity-40 ${blockedClass}`}
          disabled={disableActions}
        >
          <RotateCcw size={18} />
        </button>
      </Tooltip>
      {onToggleClock && (
        <Tooltip content={showClock ? 'Hide Clock' : 'Show Clock'}>
          <button
            type="button"
            onClick={onToggleClock}
            aria-disabled={readOnly}
            className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition ${showClock
                ? 'border-rose-400 bg-rose-500/20 text-rose-100'
                : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-white/70'
              } ${blockedClass}`}
            aria-label={showClock ? 'Hide clock' : 'Show clock'}
          >
            <Clock3 size={16} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
