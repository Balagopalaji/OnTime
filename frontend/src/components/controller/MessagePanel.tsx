/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react'
import type { MessageColor } from '../../types'
import { Tooltip } from '../core/Tooltip'

const PRESETS = [
  { label: 'Wrap Up', text: 'Wrap Up', color: 'yellow' as MessageColor },
  { label: 'Applause', text: 'Applause', color: 'green' as MessageColor },
  { label: 'Standby', text: 'Standby', color: 'blue' as MessageColor },
]

const MAX_MESSAGE_LENGTH = 150

export const MessagePanel = ({
  initial,
  onUpdate,
  disabled = false,
  onBlocked,
}: {
  initial: { text: string; color: MessageColor; visible: boolean }
  onUpdate: (message: {
    text?: string
    color?: MessageColor
    visible?: boolean
  }) => void
  disabled?: boolean
  onBlocked?: () => void
}) => {
  const [text, setText] = useState(initial.text)
  const [color, setColor] = useState<MessageColor>(initial.color)
  const [visible, setVisible] = useState(initial.visible)
  const [lastBroadcast, setLastBroadcast] = useState<{ text: string; color: MessageColor }>({
    text: initial.text,
    color: initial.color,
  })
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    // Sync local state when upstream message changes (e.g., undo/reset)
    setText(initial.text)
    setColor(initial.color)
    setVisible(initial.visible)
    setLastBroadcast({ text: initial.text, color: initial.color })
  }, [initial.color, initial.text, initial.visible])

  const getTextareaClasses = (swatch: MessageColor, isLive: boolean) => {
    const liveColors: Record<MessageColor, string> = {
      green: 'bg-emerald-500/80 text-white border-emerald-200/70',
      yellow: 'bg-amber-400/80 text-slate-900 border-amber-200/70',
      red: 'bg-rose-500/80 text-white border-rose-300/60',
      blue: 'bg-sky-500/80 text-white border-sky-300/70',
      white: 'bg-white text-slate-900 border-white/70',
      none: 'bg-slate-900/90 text-white border-slate-700',
    }

    const idleColors: Record<MessageColor, string> = {
      green: 'bg-emerald-500/15 text-emerald-100 border-emerald-400/30',
      yellow: 'bg-amber-400/20 text-amber-100 border-amber-300/40',
      red: 'bg-rose-500/15 text-rose-100 border-rose-300/40',
      blue: 'bg-sky-500/15 text-sky-100 border-sky-300/40',
      white: 'bg-white/10 text-white border-white/30',
      none: 'bg-slate-950/70 text-white border-slate-800',
    }

    return isLive ? liveColors[swatch] : idleColors[swatch]
  }

  const applyChange = (next: Partial<{ text: string; color: MessageColor }>) => {
    if (disabled) {
      onBlocked?.()
      return
    }
    if (next.text !== undefined) setText(next.text)
    if (next.color !== undefined) setColor(next.color)
    onUpdate({ ...next, visible })
  }

  const handleBroadcast = () => {
    if (disabled) {
      onBlocked?.()
      return
    }
    onUpdate({ text, color, visible: true })
    setLastBroadcast({ text, color })
    setVisible(true)
    setPulse(true)
    window.setTimeout(() => setPulse(false), 180)
  }

  const handleToggle = () => {
    if (disabled) {
      onBlocked?.()
      return
    }
    if (visible) {
      const hasNewContent = text !== lastBroadcast.text || color !== lastBroadcast.color
      if (hasNewContent) {
        handleBroadcast()
        return
      }
      onUpdate({ visible: false })
      setVisible(false)
      return
    }
    handleBroadcast()
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Message Panel</h2>
        <Tooltip content="Show message on viewer">
          <button
            type="button"
            onClick={visible ? handleToggle : handleBroadcast}
            aria-disabled={disabled}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide border transition transform active:scale-[0.97] ${visible
                ? 'border-rose-500/60 bg-rose-500/30 text-white'
                : 'border-emerald-400/60 text-emerald-200'
              } ${pulse ? 'shadow-[0_0_0_6px_rgba(16,185,129,0.25)] scale-[0.98]' : ''} ${
              visible ? '' : 'hover:shadow-[0_0_0_4px_rgba(16,185,129,0.18)] hover:scale-[0.99]'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            Broadcast
          </button>
        </Tooltip>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyChange({ text: preset.text, color: preset.color })}
            aria-disabled={disabled}
            className={`rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-200 transition hover:border-white/70 ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3 text-sm">
        <label className="block rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-white">
          Custom text
          <textarea
            className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${getTextareaClasses(
              color,
              visible,
            )}`}
            value={text}
            readOnly={disabled}
            onFocus={() => {
              if (disabled) onBlocked?.()
            }}
            onChange={(event) => {
              if (disabled) {
                onBlocked?.()
                return
              }
              setText(event.target.value.slice(0, MAX_MESSAGE_LENGTH))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleBroadcast()
              }
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
          />
          <span className="mt-1 block text-right text-xs text-slate-200">
            {text.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Color</span>
          <div className="flex flex-wrap gap-2">
            {(['white', 'green', 'yellow', 'red', 'blue', 'none'] as MessageColor[]).map(
              (swatch) => (
                <button
                  type="button"
                  key={swatch}
                  onClick={() => applyChange({ color: swatch })}
                  aria-disabled={disabled}
                  className={`h-8 w-8 rounded-full border-2 ${swatch === 'none'
                      ? 'border-white/40'
                      : swatch === 'white'
                        ? 'bg-white border-transparent'
                        : swatch === 'yellow'
                          ? 'bg-amber-400 border-transparent'
                          : swatch === 'red'
                            ? 'bg-rose-500 border-transparent'
                            : swatch === 'blue'
                              ? 'bg-sky-500 border-transparent'
                              : 'bg-emerald-500 border-transparent'
                    } ${color === swatch ? 'ring-2 ring-white' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                  data-color={swatch}
                >
                  <span className="sr-only">{swatch}</span>
                </button>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
