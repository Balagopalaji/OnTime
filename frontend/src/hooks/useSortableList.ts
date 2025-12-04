import { useMemo, useRef, useState } from 'react'

type SortableItem<T> = {
  id: string
  value: T
}

type DragState = {
  draggingId: string | null
  overIndex: number | null
}

type UseSortableListProps<T> = {
  items: Array<SortableItem<T>>
  onReorder: (fromIndex: number, toIndex: number) => void
}

type UseSortableListResult<T> = {
  items: Array<SortableItem<T>>
  draggingId: string | null
  overIndex: number | null
  getItemProps: (id: string, index: number) => {
    draggable: true
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragEnd: () => void
    onDrop: (event: React.DragEvent) => void
  }
  getHandleProps: (id: string, index: number) => {
    tabIndex: number
    role: string
    'aria-grabbed': boolean
    onKeyDown: (event: React.KeyboardEvent) => void
    onMouseDown: (event: React.MouseEvent) => void
    onPointerDown: (event: React.PointerEvent) => void
  }
}

export const useSortableList = <T,>({
  items,
  onReorder,
}: UseSortableListProps<T>): UseSortableListResult<T> => {
  const [dragState, setDragState] = useState<DragState>({ draggingId: null, overIndex: null })
  const draggingIdRef = useRef<string | null>(null)
  const dragFromIndexRef = useRef<number | null>(null)
  const overIndexRef = useRef<number | null>(null)

  const sorted = useMemo(() => items, [items])

  const finishDrag = () => {
    const targetIndex = overIndexRef.current ?? dragState.overIndex
    const draggingId = draggingIdRef.current ?? dragState.draggingId
    if (draggingId !== null && dragFromIndexRef.current !== null && targetIndex !== null) {
      const fromIndex = dragFromIndexRef.current
      const toIndex = targetIndex
      if (fromIndex !== toIndex && toIndex >= 0 && toIndex <= sorted.length) {
        onReorder(fromIndex, toIndex)
      }
    }
    draggingIdRef.current = null
    dragFromIndexRef.current = null
    overIndexRef.current = null
    setDragState({ draggingId: null, overIndex: null })
  }

  const getItemProps = (id: string, index: number) => ({
    draggable: true as const,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'move'
      draggingIdRef.current = id
      dragFromIndexRef.current = index
      overIndexRef.current = index
      setDragState({ draggingId: id, overIndex: index })
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      if (!draggingIdRef.current && dragState.draggingId === null) return
      overIndexRef.current = index
      setDragState((prev) => ({ ...prev, overIndex: index }))
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      finishDrag()
    },
    onDragEnd: () => {
      finishDrag()
    },
  })

  const getHandleProps = (id: string, index: number) => ({
    tabIndex: 0,
    role: 'button',
    'aria-grabbed': dragState.draggingId === id,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === ' ' || event.key.toLowerCase() === 'enter') {
        event.preventDefault()
        if (dragState.draggingId === null) {
          draggingIdRef.current = id
          dragFromIndexRef.current = index
          overIndexRef.current = index
          setDragState({ draggingId: id, overIndex: index })
        } else {
          finishDrag()
        }
      }
      const activeId = draggingIdRef.current ?? dragState.draggingId
      if (activeId === id) {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setDragState((prev) => {
            const next = Math.max(0, (prev.overIndex ?? index) - 1)
            overIndexRef.current = next
            return { ...prev, overIndex: next }
          })
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setDragState((prev) => {
            const next = Math.min(sorted.length, (prev.overIndex ?? index) + 1)
            overIndexRef.current = next
            return { ...prev, overIndex: next }
          })
        }
      }
    },
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  })

  return {
    items: sorted,
    draggingId: dragState.draggingId,
    overIndex: dragState.overIndex,
    getItemProps,
    getHandleProps,
  }
}
