import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublisherDeviceApprovalPage, type ApproveDecision } from './PublisherDeviceApprovalPage'

const CHALLENGE = 'c'.repeat(32)

function renderPage(search: string, approve: ApproveDecision, openCallback = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/publisher/device/approve${search}`]}>
      <PublisherDeviceApprovalPage approve={approve} openCallback={openCallback} />
    </MemoryRouter>,
  )
  return { approve, openCallback }
}

describe('PublisherDeviceApprovalPage', () => {
  afterEach(cleanup)

  it('explains what is being approved and approves once, then hands the one-time code to the app callback', async () => {
    // Defect: the owner approves a device without seeing what it grants, or double-submits.
    const approve = vi.fn(async () => ({ status: 'approved' as const, callbackUrl: `downstage-ppt-timer://publisher-auth?challenge=${CHALLENGE}&code=${'k'.repeat(43)}` }))
    const { openCallback } = renderPage(`?challenge=${CHALLENGE}`, approve)
    expect(screen.getByRole('heading', { name: 'Link PPT Timer to your account?' })).toBeInTheDocument()
    expect(screen.getByText(/Only approve if you just chose Share Remotely in PPT Timer on this computer/)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Approve' })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve).toHaveBeenCalledWith({ challengeId: CHALLENGE, decision: 'approve' })
    expect(openCallback).toHaveBeenCalledWith(`downstage-ppt-timer://publisher-auth?challenge=${CHALLENGE}&code=${'k'.repeat(43)}`)
    expect(screen.getByText('Approved. Returning to PPT Timer…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open PPT Timer' })).toHaveAttribute('href', expect.stringMatching(/^downstage-ppt-timer:\/\//))
  })

  it('denies without opening the app', async () => {
    const approve = vi.fn(async () => ({ status: 'denied' as const }))
    const { openCallback } = renderPage(`?challenge=${CHALLENGE}`, approve)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Deny' })))
    expect(approve).toHaveBeenCalledWith({ challengeId: CHALLENGE, decision: 'deny' })
    expect(openCallback).not.toHaveBeenCalled()
    expect(screen.getByText('Denied. No device was linked; you can close this tab.')).toBeInTheDocument()
  })

  it.each([
    ['functions/failed-precondition', 'This request was already used. Start again from PPT Timer.'],
    ['functions/deadline-exceeded', 'This request expired. Start again from PPT Timer.'],
    ['functions/not-found', 'This approval link is not valid. Start again from PPT Timer.'],
    ['functions/permission-denied', 'Sign in with your own OnTime account to approve devices.'],
    ['functions/unavailable', 'Could not reach OnTime. Check your connection and try again.'],
  ])('maps %s to actionable copy', async (code, copy) => {
    const approve = vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { code })))
    renderPage(`?challenge=${CHALLENGE}`, approve)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })))
    expect(screen.getByRole('alert')).toHaveTextContent(copy)
  })

  it.each(['', '?challenge=short', '?challenge=' + 'c'.repeat(32) + '%2F'])('rejects a malformed link %j without calling the server', (search) => {
    const approve = vi.fn()
    renderPage(search, approve)
    expect(screen.getByRole('alert')).toHaveTextContent('This approval link is not valid. Start again from PPT Timer.')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it.each(['javascript:alert(1)', 'https://evil.example/publisher-auth?x', 'ms-officecmd://publisher-auth?challenge=x&code=y'])('refuses to open a callback that is not the PPT Timer scheme: %s', async (callbackUrl) => {
    // Defect: a tampered response launches a web page or another installed protocol handler.
    const approve = vi.fn(async () => ({ status: 'approved' as const, callbackUrl }))
    const { openCallback } = renderPage(`?challenge=${CHALLENGE}`, approve)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })))
    expect(openCallback).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach OnTime. Check your connection and try again.')
  })
})
