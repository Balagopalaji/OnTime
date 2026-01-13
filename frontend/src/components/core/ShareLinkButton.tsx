import { CopyButton } from './CopyButton'
import { getCloudViewerUrl } from '../../lib/viewer-links'

export const ShareLinkButton = ({ roomId }: { roomId: string }) => {
  const viewerUrl = getCloudViewerUrl(roomId)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm">
      <span className="truncate text-slate-300">{viewerUrl}</span>
      <CopyButton value={viewerUrl} />
    </div>
  )
}
