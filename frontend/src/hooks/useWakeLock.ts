import { useEffect, useRef } from 'react'

/**
 * Requests the Screen Wake Lock API where available.
 * Falls back to a periodic no-op to keep the event loop active on platforms without the API.
 */
export const useWakeLock = (enabled: boolean) => {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const fallbackRef = useRef<number | null>(null)

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        // @ts-expect-error - wakeLock is experimental
        if ('wakeLock' in navigator) {
          // @ts-expect-error - wakeLock is experimental
          const sentinel = await navigator.wakeLock.request('screen')
          wakeLockRef.current = sentinel
          sentinel.addEventListener('release', () => {
            wakeLockRef.current = null
          })
          return
        }
      } catch (error) {
        console.warn('Wake lock request failed', error)
      }

      // Fallback: keep event loop busy with a small no-op
      fallbackRef.current = window.setInterval(() => {
        // no-op to keep the page active
      }, 60_000)
    }

    if (!enabled) return
    void requestWakeLock()

    return () => {
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
}
