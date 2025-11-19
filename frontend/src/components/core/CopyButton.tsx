import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export const CopyButton = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('Clipboard copy failed', error)
    }
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1 text-xs text-slate-100 transition hover:border-slate-600"
      onClick={handleCopy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
