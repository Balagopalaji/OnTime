// rebuild-target: app-internal (cloud-web session viewer)
import { useEffect, useState } from 'react'
import type { TimerDisplayModel } from '@ontime/timer-face'
import { createLanSessionFollower } from './lan-session-follower'
import type { LanSnapshotTransport } from './lan-snapshot-adapter'

const CONNECTING: TimerDisplayModel = { connection: 'connecting', statusText: 'Connecting', timeText: '--:--', disclosureRows: [] }

const monotonicNow = () => performance.now()

/**
 * LAN counterpart of `usePresentationSession`. The socket transport is injected
 * (it lives with the Companion connection code, outside this directory), so
 * this hook stays free of socket, Companion, and room/timer-context imports.
 * `createTransport` and `onAccessEnded` must be referentially stable (the effect restarts on change).
 */
export function useLanPresentationSession(
  roomId: string,
  createTransport: () => LanSnapshotTransport,
  onAccessEnded?: () => void,
): TimerDisplayModel {
  const [display, setDisplay] = useState<TimerDisplayModel>(CONNECTING)
  useEffect(() => {
    let follower: ReturnType<typeof createLanSessionFollower> | null = null
    // Deferred one task, transport included, so StrictMode's discarded first mount opens no socket.
    const starting = setTimeout(() => {
      follower = createLanSessionFollower({
        roomId,
        transport: createTransport(),
        now: monotonicNow,
        onDisplay: setDisplay,
        onAccessEnded,
      })
      follower.start()
    }, 0)
    return () => {
      clearTimeout(starting)
      void follower?.stop()
    }
  }, [roomId, createTransport, onAccessEnded])
  return display
}
