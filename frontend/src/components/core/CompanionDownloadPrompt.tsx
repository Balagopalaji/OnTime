import { X, Download, MonitorPlay } from 'lucide-react'

export const CompanionDownloadPrompt = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) => {
  if (!isOpen) return null

  // Simple OS detection
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  const downloadUrl = isMac
    ? 'https://github.com/Balagopalaji/OnTime/releases/download/v0.1.0/OnTime.Companion-0.1.0-arm64-mac.zip'
    : 'https://github.com/Balagopalaji/OnTime/releases/download/v0.1.0/OnTime.Companion%20Setup%200.1.0.exe' 
  
  const osLabel = isMac ? 'Mac (Apple Silicon)' : 'Windows'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-card text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-white"
        >
          <X size={20} />
        </button>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-slate-300">
          <MonitorPlay size={24} />
        </div>

        <h3 className="text-lg font-semibold text-white">Companion App Required</h3>
        <p className="mt-2 text-sm text-slate-400">
          To control PowerPoint and run local timers, you need the free Companion App running on this computer.
        </p>

        <div className="mt-6 space-y-3">
          <a
            href={downloadUrl}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            <Download size={18} />
            Download for {osLabel}
          </a>
          
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-slate-800 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-900"
          >
            I already have it running
          </button>
        </div>
      </div>
    </div>
  )
}
