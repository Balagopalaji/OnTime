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
})
