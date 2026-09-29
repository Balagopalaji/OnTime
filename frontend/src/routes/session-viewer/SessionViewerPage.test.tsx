import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionViewerPage } from './SessionViewerPage'
import type { PresentationTransport } from './presentation-session-controller'

const TOKEN = 'T'.repeat(43)
const T0 = 1_790_000_000_000

function fakeTransport() {
  const listeners: { snapshot?: (doc: unknown) => void; state?: (s: unknown) => void } = {}
  const transport: PresentationTransport = {
    resolve: vi.fn(async () => ({ customToken: 'custom', serverNowMs: T0, activeWindowExpiresAtMs: T0 + 86_400_000 })),
    signIn: vi.fn(async () => {}),
    onViewerState: vi.fn((_id, next) => {
      listeners.state = next as (s: unknown) => void
      return vi.fn()
    }),
    onSnapshot: vi.fn((_id, next) => {
      listeners.snapshot = next
      return vi.fn()
    }),
    close: vi.fn(async () => {}),
  }
  return { transport, listeners }
}

const snapshotDoc = {
  snapshot: {
    schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: 'sess_1', epoch: 1, sequence: 1,
    observedAtMs: T0, observationAgeMs: 0, preCommitTransitMs: 0, publishedAtMs: T0,
    heartbeatIntervalMs: 10_000, staleAfterMs: 25_000, disconnectAfterMs: 60_000, availability: 'active',
    payload: {
      reason: 'presentation', presentationState: 'playing', slideNumber: 1, slideCount: 3, displayTitle: 'Sunday',
      headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [
        { ordinal: 0, label: 'Walk-in loop', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true },
        { ordinal: 1, label: 'Sermon bumper', status: 'ready', durationMs: 45_000, elapsedMsAtObservation: null, remainingMsAtObservation: null, isFocus: false },
      ],
    },
  },
  cleanupAfterMs: T0 + 1,
}

function renderAt(url: string, fake = fakeTransport(), strict = false) {
  window.history.replaceState(null, '', url)
  const factory = () => fake.transport
  const tree = (
    <MemoryRouter initialEntries={[url.split('#')[0]]}>
      <Routes>
        <Route path="/session/:sessionId/view" element={<SessionViewerPage createTransport={factory} />} />
      </Routes>
    </MemoryRouter>
  )
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { ...view, fake }
}

describe('SessionViewerPage (cloud browser viewer)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('resolves with the fragment token, scrubs it, and shows the compact face (RPV-003)', async () => {
    const { fake } = renderAt(`/session/sess_1/view#token=${TOKEN}`)
    expect(window.location.hash).toBe('')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fake.transport.resolve).toHaveBeenCalledWith('sess_1', TOKEN)
    act(() => fake.listeners.snapshot?.(snapshotDoc))
    await act(() => vi.advanceTimersByTimeAsync(250))
    expect(document.querySelector('#badge')?.textContent).toBe('Playing')
    expect(document.querySelector('#time')?.textContent).toMatch(/^01:(29|30)$/)
    // Collapsed face: status + time only; no video title.
    expect(screen.queryByText('Walk-in loop')).toBeNull()
  })

  it('reveals the disclosure rows with the selected video title on demand (RPV-002/RPV-006)', async () => {
    const { fake } = renderAt(`/session/sess_1/view#token=${TOKEN}`)
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => fake.listeners.snapshot?.(snapshotDoc))
    await act(() => vi.advanceTimersByTimeAsync(250))
    const toggle = screen.getByRole('button', { name: 'Show video list' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide video list' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Walk-in loop')).toBeInTheDocument()
    expect(screen.getByText('Sermon bumper')).toBeInTheDocument()
  })

  it('announces status changes politely without timer values', async () => {
    const { fake } = renderAt(`/session/sess_1/view#token=${TOKEN}`)
    await act(() => vi.advanceTimersByTimeAsync(0))
    act(() => fake.listeners.snapshot?.(snapshotDoc))
    await act(() => vi.advanceTimersByTimeAsync(250))
    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live.textContent).toBe('Playing — 1. Walk-in loop: Playing, 2. Sermon bumper: Ready')
  })

  it('keeps the link usable across a reload of the same tab (token in session storage, not the URL)', async () => {
    // Defect: a stage monitor reload mid-show strands the viewer at "Access ended".
    const first = renderAt(`/session/sess_1/view#token=${TOKEN}`)
    await act(() => vi.advanceTimersByTimeAsync(0))
    first.unmount()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(window.location.hash).toBe('')
    const reloaded = renderAt('/session/sess_1/view')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(reloaded.fake.transport.resolve).toHaveBeenCalledWith('sess_1', TOKEN)
    // Another session in the same tab does not inherit this token.
    cleanup()
    const other = renderAt('/session/sess_2/view')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(other.fake.transport.resolve).not.toHaveBeenCalled()
  })

  it('resolves exactly once under StrictMode double mounting', async () => {
    const { fake } = renderAt(`/session/sess_1/view#token=${TOKEN}`, fakeTransport(), true)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fake.transport.resolve).toHaveBeenCalledTimes(1)
  })

  it('shows access ended for a link without a token and never resolves', async () => {
    const { fake } = renderAt('/session/sess_1/view')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fake.transport.resolve).not.toHaveBeenCalled()
    expect(document.querySelector('#message')?.textContent).toBe('Access ended')
  })

  it('closes the isolated viewer transport on unmount', async () => {
    const { fake, unmount } = renderAt(`/session/sess_1/view#token=${TOKEN}`)
    await act(() => vi.advanceTimersByTimeAsync(0))
    unmount()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(fake.transport.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
