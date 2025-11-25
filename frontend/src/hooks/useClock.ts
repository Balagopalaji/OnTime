import { useEffect, useState } from 'react'

export const useClock = (timezone?: string) => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
  }).format(now)
}
