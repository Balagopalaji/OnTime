import { useState } from 'react'
import type { MessageColor } from '../../types'

const PRESETS = [
  { label: 'Wrap Up', text: 'Wrap Up', color: 'yellow' as MessageColor },
  { label: 'Applause', text: 'Applause', color: 'green' as MessageColor },
  { label: 'Standby', text: 'Standby', color: 'blue' as MessageColor },
]

const MAX_MESSAGE_LENGTH = 150

export const MessagePanel = ({
  initial,
  onUpdate,
}: {
  initial: { text: string; color: MessageColor; visible: boolean }
  onUpdate: (message: {
    text?: string
    color?: MessageColor
    visible?: boolean
  }) => void
}) => {
  const [text, setText] = useState(initial.text)
  const [color, setColor] = useState<MessageColor>(initial.color)
  const [visible, setVisible] = useState(initial.visible)

  const applyChange = (next: Partial<{ text: string; color: MessageColor }>) => {
    if (next.text !== undefined) setText(next.text)
    if (next.color !== undefined) setColor(next.color)
    onUpdate({ ...next, visible })
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onUpdate({ text, color, visible })
  }

  const toggleVisible = () => {
    setVisible((prev) => {
      onUpdate({ visible: !prev })
      return !prev
    })
  }

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Message Panel</h2>
        <button
          type="button"
          onClick={toggleVisible}
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            visible ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-300'
          }`}
        >
          {visible ? 'Hide Viewer Message' : 'Show Viewer Message'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyChange({ text: preset.text, color: preset.color })}
            className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-200 transition hover:border-white/70"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-sm">
        <label className="block text-slate-300">
          Custom text
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={3}
          />
          <span className="mt-1 block text-right text-xs text-slate-500">
            {text.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </label>
        <label className="block text-slate-300">
          Color
          <select
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white"
            value={color}
            onChange={(event) => {
              const next = event.target.value as MessageColor
              setColor(next)
              onUpdate({ color: next })
            }}
          >
            <option value="none">No color</option>
            <option value="green">Green</option>
            <option value="yellow">Yellow</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
            <option value="white">White</option>
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex items-center rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white"
        >
          Save Message
        </button>
      </form>
    </div>
  )
}
