import { describe, it, expect } from 'vitest'
import { useSortableList } from '../hooks/useSortableList'
import { renderHook, act } from '@testing-library/react'

const makeItems = (count: number) =>
  Array.from({ length: count }).map((_, i) => ({ id: `id-${i}`, value: i }))

describe('useSortableList', () => {
  it('calls onReorder with correct indices on drag/drop', () => {
    const items = makeItems(3)
    const onReorder = vi.fn()
    const { result } = renderHook(() =>
      useSortableList({
        items,
        onReorder,
      }),
    )

    const props0 = result.current.getItemProps('id-0', 0)
    const props2 = result.current.getItemProps('id-2', 2)

    const dragEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: 'move' } } as unknown as React.DragEvent
    act(() => {
      props0.onDragStart(dragEvent)
      props2.onDragOver({ preventDefault: () => {} } as unknown as React.DragEvent)
      props2.onDrop({ preventDefault: () => {} } as unknown as React.DragEvent)
    })

    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })

  it('detaches document drag listeners when drag completes', () => {
    const items = makeItems(2)
    const onReorder = vi.fn()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result } = renderHook(() =>
      useSortableList({
        items,
        onReorder,
      }),
    )

    const props0 = result.current.getItemProps('id-0', 0)
    const props1 = result.current.getItemProps('id-1', 1)
    const dragEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: 'move' } } as unknown as React.DragEvent

    act(() => {
      props0.onDragStart(dragEvent)
      props1.onDrop({ preventDefault: () => {} } as unknown as React.DragEvent)
    })

    expect(addSpy).toHaveBeenCalledWith('dragover', expect.any(Function), { passive: false })
    expect(addSpy).toHaveBeenCalledWith('drop', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('dragend', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('drop', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('dragend', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('detaches document drag listeners on unmount', () => {
    const items = makeItems(2)
    const onReorder = vi.fn()
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result, unmount } = renderHook(() =>
      useSortableList({
        items,
        onReorder,
      }),
    )

    const props0 = result.current.getItemProps('id-0', 0)
    const dragEvent = { preventDefault: () => {}, dataTransfer: { effectAllowed: 'move' } } as unknown as React.DragEvent
    act(() => {
      props0.onDragStart(dragEvent)
      unmount()
    })

    expect(removeSpy).toHaveBeenCalledWith('dragover', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('drop', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('dragend', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))

    removeSpy.mockRestore()
  })
})
