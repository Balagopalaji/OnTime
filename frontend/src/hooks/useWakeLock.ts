import { useEffect, useRef, useState } from 'react'

/**
 * Requests the Screen Wake Lock API where available.
 * Falls back to a periodic no-op to keep the event loop active on platforms without the API.
 */
export const useWakeLock = (enabled: boolean) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const fallbackRef = useRef<number | null>(null)
  const [isSupported, setIsSupported] = useState(true)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request?: (type: 'screen') => Promise<WakeLockSentinel> } }
        if (nav.wakeLock?.request) {
          const sentinel = await nav.wakeLock.request('screen')
          wakeLockRef.current = sentinel
          if (!cancelled) {
            setIsSupported(true)
            setIsActive(true)
            setError(null)
          }
          sentinel.addEventListener('release', () => {
            wakeLockRef.current = null
            if (!cancelled) {
              setIsActive(false)
            }
          })
          return
        }
        if (!cancelled) {
          setIsSupported(false)
          setIsActive(false)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) {
          const nextError =
            caught instanceof Error ? caught : new Error('Wake lock request failed')
          setIsSupported(true)
          setIsActive(false)
          setError(nextError)
        }
      }

      // Fallback: keep event loop busy with a small no-op
      fallbackRef.current = window.setInterval(() => {
        // no-op to keep the page active
      }, 60_000)
    }

    if (!enabled) return
    void requestWakeLock()

    return () => {
      cancelled = true
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {
          /* ignore */
        })
        wakeLockRef.current = null
      }
      if (fallbackRef.current) {
        window.clearInterval(fallbackRef.current)
        fallbackRef.current = null
      }
    }
  }, [enabled])

  return { isSupported, isActive, error }
}
