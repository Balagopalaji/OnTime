import type { ConnectionStatus } from '../../types'

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  online: 'text-emerald-400 bg-emerald-400/10',
  reconnecting: 'text-amber-300 bg-amber-400/10',
  offline: 'text-rose-300 bg-rose-400/10',
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  online: 'Online',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
}

export const ConnectionIndicator = ({
  status,
}: {
  status: ConnectionStatus
}) => {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          status === 'online'
            ? 'bg-emerald-400'
            : status === 'reconnecting'
            ? 'bg-amber-300'
            : 'bg-rose-400'
        } animate-pulse`}
      />
      {STATUS_LABELS[status]}
    </span>
  )
}
