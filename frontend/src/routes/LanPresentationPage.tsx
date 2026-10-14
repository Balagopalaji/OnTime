import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { claimLanPairing } from '../lib/companion-pairing'
import { createLanSnapshotTransport } from '../lib/lan-snapshot-transport'
import { clearViewerToken, readViewerToken, writeViewerToken, type ViewerTokenState } from '../lib/lan-viewer-token'
import type { LanSnapshotTransport } from './session-viewer/lan-snapshot-adapter'
import { SessionViewerFace } from './session-viewer/SessionViewerFace'
import { useLanPresentationSession } from './session-viewer/useLanPresentationSession'

const ROLE_OPTIONS = ['all', 'lx', 'ax', 'vx', 'sm', 'foh', 'custom']

type CreateTransport = (options: { roomId: string; token: string; deviceName?: string }) => LanSnapshotTransport

const deviceNameOf = () => (typeof navigator !== 'undefined' && navigator.platform ? navigator.platform : undefined)

/** Read-only LAN presentation timer for a paired device: the same face as the cloud viewer, fed by Companion. */
function LanPresentation({
  roomId,
  token,
  createTransport,
  onAccessEnded,
}: {
  roomId: string
  token: string
  createTransport: CreateTransport
  onAccessEnded: () => void
}) {
  const create = useCallback(() => createTransport({ roomId, token, deviceName: deviceNameOf() }), [createTransport, roomId, token])
  const display = useLanPresentationSession(roomId, create, onAccessEnded)
  return <SessionViewerFace display={display} />
}

/**
 * `/room/:roomId/presentation`: pair with the pairing code from the operator
 * (same flow and token storage as the room viewer), then show the PowerPoint
 * timer Companion relays from the local publisher. Unpaired or revoked devices
 * return to the pairing prompt; nothing here can control the room or the show.
 */
export function LanPresentationPage({
  createTransport = createLanSnapshotTransport,
  claimPairing = claimLanPairing,
}: {
  createTransport?: CreateTransport
  claimPairing?: typeof claimLanPairing
}) {
  const { roomId = '' } = useParams()
  const [viewerToken, setViewerToken] = useState<ViewerTokenState | null>(() => readViewerToken(roomId))
  const [pairingCode, setPairingCode] = useState(() =>
    typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('code') ?? ''),
  )
  const [pairingRole, setPairingRole] = useState('all')
  const [pairingError, setPairingError] = useState<string | null>(null)
  const [pairingBusy, setPairingBusy] = useState(false)

  const handleAccessEnded = useCallback(() => {
    clearViewerToken(roomId)
    setViewerToken(null)
    setPairingError('Pairing expired or revoked. Request a new code.')
  }, [roomId])

  const handlePairingSubmit = async () => {
    const code = pairingCode.trim()
    if (!code) {
      setPairingError('Enter a pairing code.')
      return
    }
    setPairingBusy(true)
    setPairingError(null)
    try {
      const response = await claimPairing({ roomId, code, role: pairingRole, deviceName: deviceNameOf() })
      const next: ViewerTokenState = { token: response.token, expiresAt: response.expiresAt, role: response.role }
      writeViewerToken(roomId, next)
      setViewerToken(next)
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Pairing failed.')
    } finally {
      setPairingBusy(false)
    }
  }

  if (viewerToken && roomId) {
    return <LanPresentation roomId={roomId} token={viewerToken.token} createTransport={createTransport} onAccessEnded={handleAccessEnded} />
  }

  return (
    <div className="flex min-h-[calc(100vh-80px)] items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg rounded-3xl border border-slate-900 bg-slate-950/80 p-6 text-slate-200 shadow-card">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">LAN Viewer</p>
          <h1 className="text-2xl font-semibold text-white">Connect to this presentation</h1>
          <p className="text-sm text-slate-300">Enter the pairing code from the controller to unlock read-only access.</p>
        </div>
        {!roomId ? (
          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
            Missing room id. Ask the operator for a new LAN viewer link.
          </div>
        ) : (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handlePairingSubmit()
            }}
          >
            <label htmlFor="lan-pairing-code" className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Pairing Code
            </label>
            <input
              id="lan-pairing-code"
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300/70"
            />
            <label htmlFor="lan-pairing-role" className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Role
            </label>
            <select
              id="lan-pairing-role"
              value={pairingRole}
              onChange={(event) => setPairingRole(event.target.value)}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-emerald-300/70"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role === 'all' ? 'All roles' : role.toUpperCase()}
                </option>
              ))}
            </select>
            {pairingError ? (
              <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {pairingError}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={pairingBusy}
              className="w-full rounded-2xl border border-emerald-300/70 bg-emerald-500/20 px-4 py-3 text-sm font-semibold text-emerald-50 transition hover:border-emerald-200 disabled:opacity-60"
            >
              {pairingBusy ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
