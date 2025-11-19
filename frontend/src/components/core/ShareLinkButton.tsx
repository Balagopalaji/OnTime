import { CopyButton } from './CopyButton'

export const ShareLinkButton = ({ roomId }: { roomId: string }) => {
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://stagetime.app'

  const viewerUrl = `${origin}/room/${roomId}/view`

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
      <span className="truncate text-slate-300">{viewerUrl}</span>
      <CopyButton value={viewerUrl} />
    </div>
  )
}
