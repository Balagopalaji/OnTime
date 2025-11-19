import { formatInTimeZone } from 'date-fns-tz'

export const formatDuration = (ms: number) => {
  const sign = ms < 0 ? '-' : ''
  const duration = Math.abs(ms)
  const minutes = Math.floor(duration / 60000)
  const seconds = Math.floor((duration % 60000) / 1000)
  return `${sign}${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`
}

export const formatDate = (date: number, timezone: string) => {
  return formatInTimeZone(date, timezone, 'MMM d, yyyy • ppp')
}

export const getTimezoneSuggestion = () => {
  if (typeof Intl === 'undefined') return 'UTC'
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
}
