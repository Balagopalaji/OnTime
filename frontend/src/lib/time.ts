import { formatInTimeZone } from 'date-fns-tz'

export const formatDuration = (ms: number) => {
  const sign = ms < 0 ? '-' : ''
  const duration = Math.abs(ms)
  const hours = Math.floor(duration / 3_600_000)
  const minutes = Math.floor((duration % 3_600_000) / 60_000)
  const seconds = Math.floor((duration % 60_000) / 1000)

  const body = hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`
    : `${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`

  return `${sign}${body}`
}

export const formatDate = (date: number, timezone: string) => {
  return formatInTimeZone(date, timezone, 'MMM d, yyyy • ppp')
}

export const getTimezoneSuggestion = () => {
  if (typeof Intl === 'undefined') return 'UTC'
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
