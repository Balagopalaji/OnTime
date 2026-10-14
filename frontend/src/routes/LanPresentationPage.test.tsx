import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { claimLanPairing } from '../lib/companion-pairing'
import { LanPresentationPage } from './LanPresentationPage'
import type { LanSnapshotTransport } from './session-viewer/lan-snapshot-adapter'

const ROOM = 'room-1'
const STORAGE_KEY = `ontime:viewerToken:${ROOM}`
const NOW = 1_790_000_000_000

const snapshot = {
  schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: 'lan_session_1', epoch: 1, sequence: 1,
  observedAtMs: NOW - 100, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: NOW,
  heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability: 'active',
  payload: {
    reason: 'presentation', presentationState: 'playing', slideNumber: 1, slideCount: 3, displayTitle: 'Sunday',
    headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
    videos: [{ ordinal: 0, label: 'Walk-in loop', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true }],
  },
}
const envelope = { type: 'REMOTE_SNAPSHOT', roomId: ROOM, snapshot, timestamp: NOW }

function fakeLan() {
  const handlers = { connect: new Set<() => void>(), envelope: new Set<(value: unknown) => void>(), access: new Set<() => void>() }
  const close = vi.fn()
  const transport: LanSnapshotTransport = {
    onConnect: (h) => (handlers.connect.add(h), () => void handlers.connect.delete(h)),
    onEnvelope: (h) => (handlers.envelope.add(h), () => void handlers.envelope.delete(h)),
    onAccessEnded: (h) => (handlers.access.add(h), () => void handlers.access.delete(h)),
    close,
  }
  const create = vi.fn<(options: { roomId: string; token: string; deviceName?: string }) => LanSnapshotTransport>(() => transport)
  return {
    create,
    close,
    send: (value: unknown) => act(() => handlers.envelope.forEach((h) => h(value))),
    endAccess: () => act(() => handlers.access.forEach((h) => h())),
  }
}

const claimOk = (token = 'jwt-1') =>
  vi.fn<typeof claimLanPairing>(async ({ roomId, role }) => ({ roomId, role, token, expiresAt: Date.now() + 3_600_000 }))

function renderPage(options: { url?: string; lan?: ReturnType<typeof fakeLan>; claim?: ReturnType<typeof claimOk>; strict?: boolean } = {}) {
  const lan = options.lan ?? fakeLan()
  const claim = options.claim ?? claimOk()
  const url = options.url ?? `/room/${ROOM}/presentation`
  window.history.replaceState(null, '', url)
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/room/:roomId/presentation" element={<LanPresentationPage createTransport={lan.create} claimPairing={claim} />} />
      </Routes>
    </MemoryRouter>
  )
  render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { lan, claim }
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 10))))
const storeToken = (token = 'stored-jwt', expiresAt = Date.now() + 3_600_000) =>
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt, role: 'all' }))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LanPresentationPage (LAN pairing + presentation viewer)', () => {
  it('asks for the pairing code first and opens no socket until paired', async () => {
    // Defect: an unpaired device connects (or crashes) instead of showing the pairing prompt.
    const { lan } = renderPage()
    await settle()
    expect(screen.getByRole('heading', { name: 'Connect to this presentation' })).toBeTruthy()
    expect(screen.getByLabelText('Pairing Code')).toBeTruthy()
    expect(lan.create).not.toHaveBeenCalled()
  })

  it('requires a code, surfaces a failed claim, and keeps the prompt', async () => {
    // Defect: a bad or empty code silently does nothing.
    const claim = vi.fn<typeof claimLanPairing>(async () => {
      throw new Error('Invalid or expired pairing code.')
    })
    const { lan } = renderPage({ claim })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a pairing code.')
    fireEvent.change(screen.getByLabelText('Pairing Code'), { target: { value: 'abcd-1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid or expired pairing code.')
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ roomId: ROOM, code: 'ABCD-1234', role: 'all' }))
    expect(lan.create).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('prefills the code from the link, claims it, stores the token under the room viewer key, and shows the presentation', async () => {
    // Defect: pairing here does not share the token with the room viewer, or the display never starts.
    const { lan, claim } = renderPage({ url: `/room/${ROOM}/presentation?code=WXYZ-9876` })
    expect((screen.getByLabelText('Pairing Code') as HTMLInputElement).value).toBe('WXYZ-9876')
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'lx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await vi.waitFor(() => expect(lan.create).toHaveBeenCalled())
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ roomId: ROOM, code: 'WXYZ-9876', role: 'lx' }))
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) as string)).toMatchObject({ token: 'jwt-1', role: 'lx' })
    expect(lan.create).toHaveBeenCalledWith(expect.objectContaining({ roomId: ROOM, token: 'jwt-1' }))
    await lan.send(envelope)
    expect(screen.getByRole('main').getAttribute('data-panel-mode')).toBe('closed')
    expect(document.body.textContent).toMatch(/01:2\d/)
  })

  it('skips the prompt with a stored token and renders the same face as the cloud viewer from Companion snapshots', async () => {
    // Defect: LAN gets a second, divergent presentation UI.
    storeToken('stored-jwt')
    const { lan } = renderPage()
    await settle()
    expect(lan.create).toHaveBeenCalledWith(expect.objectContaining({ roomId: ROOM, token: 'stored-jwt' }))
    expect(screen.queryByLabelText('Pairing Code')).toBeNull()
    await lan.send(envelope)
    expect(document.querySelector('.session-viewer-face')).not.toBeNull()
    expect(document.body.textContent).toMatch(/Playing/)
    const toggle = screen.getByRole('button', { name: 'Show video list' })
    fireEvent.click(toggle)
    expect(document.body.textContent).toMatch(/Walk-in loop/)
  })

  it('an expired stored token is ignored and asks to pair again', async () => {
    // Defect: an expired token is sent to Companion on every load.
    storeToken('old', Date.now() - 1_000)
    const { lan } = renderPage()
    await settle()
    expect(screen.getByLabelText('Pairing Code')).toBeTruthy()
    expect(lan.create).not.toHaveBeenCalled()
  })

  it('revoked access clears the token and returns to the pairing prompt with a message', async () => {
    // Defect: a revoked device sits on a dead "Access ended" screen with no way to re-pair.
    storeToken('stored-jwt')
    const { lan } = renderPage()
    await settle()
    await lan.endAccess()
    expect((await screen.findByRole('alert')).textContent).toBe('Pairing expired or revoked. Request a new code.')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(lan.close).toHaveBeenCalled()
  })

  it('under StrictMode creates one transport and closes it on unmount', async () => {
    // Defect: the discarded first mount leaks a socket carrying the viewer token.
    storeToken('stored-jwt')
    const { lan } = renderPage({ strict: true })
    await settle()
    expect(lan.create).toHaveBeenCalledTimes(1)
    cleanup()
    expect(lan.close).toHaveBeenCalledTimes(1)
  })

  it('never writes the token to the URL', async () => {
    // Defect: the bearer token leaks into history or referrers.
    const { lan } = renderPage({ url: `/room/${ROOM}/presentation?code=WXYZ-9876` })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await vi.waitFor(() => expect(lan.create).toHaveBeenCalled())
    await lan.send(envelope)
    expect(window.location.href).not.toContain('jwt-1')
  })
})
