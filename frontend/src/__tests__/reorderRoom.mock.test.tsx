import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MockDataProvider } from '../context/MockDataContext'
import { useDataContext } from '../context/DataProvider'

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1', displayName: 'Tester' } }),
}))

vi.mock('../lib/utils', async () => {
  const actual = await vi.importActual<typeof import('../lib/utils')>('../lib/utils')
  return { ...actual, delay: () => Promise.resolve() }
})

describe.skip('reorderRoom (mock provider)', () => {
  it('persists custom order when dragging rooms', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MockDataProvider>{children}</MockDataProvider>
    )
    const { result } = renderHook(() => useDataContext(), { wrapper })

    await act(async () => {
      await result.current.createRoom({ title: 'First', timezone: 'UTC', ownerId: 'user-1' })
      await result.current.createRoom({ title: 'Second', timezone: 'UTC', ownerId: 'user-1' })
    })

    const initial = result.current.rooms.filter((room) => room.ownerId === 'user-1')
    expect(initial.map((room) => room.title)).toEqual(['First', 'Second'])

    await act(async () => {
      await result.current.reorderRoom?.(initial[1].id, 0)
    })

    const reordered = result.current.rooms.filter((room) => room.ownerId === 'user-1')
    expect(reordered.map((room) => room.title)).toEqual(['Second', 'First'])
    expect(reordered[0]?.order).toBeLessThan(reordered[1]?.order ?? Infinity)
  })
})
