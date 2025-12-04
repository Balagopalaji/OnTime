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
    'data-sort-id': string
    'data-sort-index': number
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragEnter: (event: React.DragEvent) => void
    onPointerEnter: (event: React.PointerEvent) => void
    onPointerUp: (event: React.PointerEvent) => void
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
  const rectsRef = useRef<Array<{ index: number; centerX: number; centerY: number }>>([])
  const transparentDragImageRef = useRef<HTMLImageElement | null>(null)

  const sorted = useMemo(() => items, [items])

  const finishDrag = () => {
    if (draggingIdRef.current === null) return
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
    window.setTimeout(() => setDragState({ draggingId: null, overIndex: null }), 48)
  }

  const computeNearestIndex = (clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
    const rects = rectsRef.current
    if (!rects.length) return null
    let best: { index: number; dist: number } | null = null
    rects.forEach((entry) => {
      const dist =
        (entry.centerX - clientX) * (entry.centerX - clientX) +
        (entry.centerY - clientY) * (entry.centerY - clientY)
      if (!best || dist < best.dist) {
        best = { index: entry.index, dist }
      }
    })
    return best?.index ?? null
  }

  const hydrateRects = () => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-sort-index]'))
    rectsRef.current = elements
      .map((el) => {
        const idx = Number(el.dataset.sortIndex)
        if (Number.isNaN(idx)) return null
        const rect = el.getBoundingClientRect()
        return {
          index: idx,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        }
      })
      .filter((entry): entry is { index: number; centerX: number; centerY: number } => entry !== null)
  }

  const getItemProps = (id: string, index: number) => ({
    draggable: true as const,
    'data-sort-id': id,
    'data-sort-index': index,
    onDragStart: (event: React.DragEvent) => {
      const transfer = event.dataTransfer
      if (transfer) {
        transfer.effectAllowed = 'move'
        transfer.dropEffect = 'move'
        if (transfer.setData) {
          transfer.setData('text/plain', id)
        }
        if (!transparentDragImageRef.current) {
          const img = new Image()
          img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
          transparentDragImageRef.current = img
        }
        if (transparentDragImageRef.current && transfer.setDragImage) {
          transfer.setDragImage(transparentDragImageRef.current, 0, 0)
        }
      }
      draggingIdRef.current = id
      dragFromIndexRef.current = index
      overIndexRef.current = index
      setDragState({ draggingId: id, overIndex: index })
      hydrateRects()
      const handler = (nativeEvent: DragEvent) => {
        nativeEvent.preventDefault()
        const nearest = computeNearestIndex(nativeEvent.clientX, nativeEvent.clientY)
        if (nearest !== null) {
          overIndexRef.current = nearest
          setDragState((prev) => ({ ...prev, overIndex: nearest }))
        }
      }
      document.addEventListener('dragover', handler, { passive: false })
      const dropHandler = (nativeEvent: DragEvent) => {
        nativeEvent.preventDefault()
        finishDrag()
        document.removeEventListener('dragover', handler)
        document.removeEventListener('drop', dropHandler)
      }
      document.addEventListener('drop', dropHandler)
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      if (!draggingIdRef.current && dragState.draggingId === null) return
      const nearest = computeNearestIndex(event.clientX, event.clientY)
      const nextIndex = nearest ?? index
      overIndexRef.current = nextIndex
      setDragState((prev) => ({ ...prev, overIndex: nextIndex }))
    },
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault()
      if (!draggingIdRef.current && dragState.draggingId === null) return
      const nearest = computeNearestIndex(event.clientX, event.clientY)
      const nextIndex = nearest ?? index
      overIndexRef.current = nextIndex
      setDragState((prev) => ({ ...prev, overIndex: nextIndex }))
    },
    onPointerEnter: () => {
      if (!draggingIdRef.current && dragState.draggingId === null) return
      overIndexRef.current = index
      setDragState((prev) => ({ ...prev, overIndex: index }))
    },
    onPointerUp: () => {
      if (!draggingIdRef.current && dragState.draggingId === null) return
      finishDrag()
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
    onMouseDown: () => {},
    onPointerDown: () => {},
  })

  return {
    items: sorted,
    draggingId: dragState.draggingId,
    overIndex: dragState.overIndex,
    getItemProps,
    getHandleProps,
  }
}
