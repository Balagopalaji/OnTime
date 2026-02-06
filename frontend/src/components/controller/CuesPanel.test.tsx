import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Cue, Section, Segment } from '../../types'
import { CuesPanel } from './CuesPanel'

const baseSection: Section = {
  id: 'section-1',
  roomId: 'room-1',
  title: 'Section 1',
  order: 10,
}

const baseSegment: Segment = {
  id: 'segment-1',
  roomId: 'room-1',
  title: 'Segment 1',
  order: 10,
  sectionId: 'section-1',
}

const baseCue: Cue = {
  id: 'cue-1',
  roomId: 'room-1',
  role: 'lx',
  title: 'Lights',
  triggerType: 'timed',
  createdBy: 'user-1',
  sectionId: 'section-1',
}

const renderPanel = (overrides?: Partial<ComponentProps<typeof CuesPanel>>) => {
  const props: ComponentProps<typeof CuesPanel> = {
    roomId: 'room-1',
    cues: [],
    sections: [baseSection],
    segments: [baseSegment],
    readOnly: false,
    isOwner: false,
    currentUserId: 'user-1',
    onCreateCue: vi.fn(),
    onUpdateCue: vi.fn(),
    onDeleteCue: vi.fn(),
    onReorderCues: vi.fn(),
    ...overrides,
  }
  render(<CuesPanel {...props} />)
  return props
}

describe('CuesPanel', () => {
  it('renders a drop zone when a list is empty', () => {
    renderPanel({ cues: [] })
    expect(screen.getAllByText('Drop cue here').length).toBeGreaterThan(0)
  })

  it('creates cues with createdByRole from selected role', () => {
    const props = renderPanel()
    const roleSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(roleSelect, { target: { value: 'lx' } })

    const addButtons = screen.getAllByText('Add cue')
    fireEvent.click(addButtons[0])

    expect(props.onCreateCue).toHaveBeenCalledTimes(1)
    expect(props.onCreateCue).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'lx',
        createdByRole: 'lx',
      }),
    )
  })

  it('disables edits when role mismatches', () => {
    renderPanel({ cues: [{ ...baseCue, role: 'ax' }] })
    const roleSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(roleSelect, { target: { value: 'lx' } })

    const deleteButton = screen.getAllByText('Delete')[0]
    expect(deleteButton).toBeDisabled()
  })

  it('freezes acked cues for non-owners', () => {
    renderPanel({ cues: [{ ...baseCue, ackState: 'done' }] })
    const roleSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(roleSelect, { target: { value: 'lx' } })

    const doneButton = screen.getAllByRole('button', { name: /done/i })[0]
    expect(doneButton).toBeDisabled()
  })

  it('writes ack + editedByRole on acknowledge', () => {
    const props = renderPanel({ cues: [baseCue] })
    const roleSelect = screen.getAllByRole('combobox')[0]
    fireEvent.change(roleSelect, { target: { value: 'lx' } })

    const doneButton = screen.getAllByText(/done/i)[0]
    fireEvent.click(doneButton)

    expect(props.onUpdateCue).toHaveBeenCalledTimes(1)
    expect(props.onUpdateCue).toHaveBeenCalledWith(
      'cue-1',
      expect.objectContaining({
        ackState: 'done',
        ackBy: 'user-1',
        ackAt: expect.any(Number),
        editedByRole: 'lx',
      }),
    )
  })

  it('writes editedByRole null when no role is active', () => {
    const props = renderPanel({ cues: [baseCue], isOwner: true, currentUserId: 'owner-1' })
    const doneButton = screen.getAllByText(/done/i)[0]
    fireEvent.click(doneButton)

    expect(props.onUpdateCue).toHaveBeenCalledTimes(1)
    expect(props.onUpdateCue).toHaveBeenCalledWith(
      'cue-1',
      expect.objectContaining({
        editedByRole: null,
      }),
    )
  })
})
