const FALLBACK_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Australia/Sydney',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'America/Denver',
  'America/Toronto',
  'America/Mexico_City',
]

export const getAllTimezones = () => {
  if (typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone')
  }
  return FALLBACK_TIMEZONES
}
