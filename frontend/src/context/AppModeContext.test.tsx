import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppModeProvider, useAppMode } from './AppModeContext'

const { mockConnection } = vi.hoisted(() => ({
  mockConnection: {
    isConnected: false,
    handshakeStatus: 'idle' as 'idle' | 'pending' | 'ack' | 'error',
    socket: null,
  },
}))

vi.mock('./CompanionConnectionContext', () => ({
  useCompanionConnection: () => mockConnection,
}))

const STORAGE_KEY = 'ontime:appMode'

const Probe = () => {
  const { mode, effectiveMode, isDegraded, triggerCompanionFallback, clearDegraded } = useAppMode()
  return (
    <>
      <div data-testid="mode-readout">{`${mode}|${effectiveMode}|${String(isDegraded)}`}</div>
      <button type="button" onClick={triggerCompanionFallback}>
        trigger-fallback
      </button>
      <button type="button" onClick={clearDegraded}>
        clear-degraded
      </button>
    </>
  )
}

const renderProvider = () =>
  render(
    <AppModeProvider>
      <Probe />
    </AppModeProvider>,
  )

describe('AppModeProvider mode resolution', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.assign(mockConnection, {
      isConnected: false,
      handshakeStatus: 'idle',
      socket: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses local authority when mode is local even when cloud is online', () => {
    window.localStorage.setItem(STORAGE_KEY, 'local')
    Object.assign(mockConnection, { isConnected: false, handshakeStatus: 'idle' })

    renderProvider()

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('local|local|false')
  })

  it('uses cloud authority when mode is cloud and cloud is online', () => {
    window.localStorage.setItem(STORAGE_KEY, 'cloud')
    Object.assign(mockConnection, { isConnected: true, handshakeStatus: 'ack' })

    renderProvider()

    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'online' }))
    })

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('cloud|cloud|false')
  })

  it('uses local authority in auto mode when companion is connected and handshaked', () => {
    window.localStorage.setItem(STORAGE_KEY, 'auto')
    Object.assign(mockConnection, { isConnected: true, handshakeStatus: 'ack' })

    renderProvider()

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|local|false')
  })

  it('uses local authority in auto mode during pre-ACK reconnect windows', () => {
    window.localStorage.setItem(STORAGE_KEY, 'auto')
    Object.assign(mockConnection, { isConnected: true, handshakeStatus: 'pending' })

    renderProvider()
    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'online' }))
    })

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|local|false')
  })

  it('falls back to cloud in auto mode when companion is unavailable and cloud is online', () => {
    window.localStorage.setItem(STORAGE_KEY, 'auto')
    Object.assign(mockConnection, { isConnected: false, handshakeStatus: 'idle' })

    renderProvider()

    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'online' }))
    })

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|cloud|false')
  })

  it('falls back to local in auto mode when cloud is offline', () => {
    window.localStorage.setItem(STORAGE_KEY, 'auto')
    Object.assign(mockConnection, { isConnected: false, handshakeStatus: 'idle' })

    renderProvider()

    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'offline' }))
    })

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|local|false')
  })

  it('does not remain cloud-pinned while degraded when cloud churns offline', () => {
    window.localStorage.setItem(STORAGE_KEY, 'auto')
    Object.assign(mockConnection, { isConnected: true, handshakeStatus: 'ack' })

    renderProvider()

    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|local|false')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'trigger-fallback' }))
    })
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|cloud|true')

    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'offline' }))
    })
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|local|true')

    act(() => {
      window.dispatchEvent(new CustomEvent('ontime:cloud-status', { detail: 'online' }))
    })
    expect(screen.getByTestId('mode-readout')).toHaveTextContent('auto|cloud|true')
  })
})
