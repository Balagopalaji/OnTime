import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

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
  groupId?: string
  itemType?: string
  onForeignDrop?: (foreignId: string, fromGroupId: string, targetIndex: number) => void
  handleOnly?: boolean
}

type UseSortableListResult<T> = {
  items: Array<SortableItem<T>>
  draggingId: string | null
  overIndex: number | null
  getItemProps: (id: string, index: number) => {
    draggable: boolean
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
    draggable?: boolean
    'data-sort-id'?: string
    tabIndex: number
    role: string
    'aria-grabbed': boolean
    onKeyDown: (event: React.KeyboardEvent) => void
    onMouseDown: (event: React.MouseEvent) => void
    onPointerDown: (event: React.PointerEvent) => void
    onDragStart?: (event: React.DragEvent) => void
    onDragEnd?: () => void
  }
}

// Module-level state so all sortable lists can coordinate cross-container drags.
let activeDrag: { id: string; itemType: string; groupId: string } | null = null
let handledDragId: string | null = null

export const getActiveDrag = () => activeDrag

export const useSortableList = <T,>({
  items,
  onReorder,
  containerRef,
  groupId,
  itemType,
  onForeignDrop,
  handleOnly,
}: UseSortableListProps<T> & { containerRef?: RefObject<HTMLElement | null> }): UseSortableListResult<T> => {
  const [dragState, setDragState] = useState<DragState>({ draggingId: null, overIndex: null })
  const draggingIdRef = useRef<string | null>(null)
  const dragFromIndexRef = useRef<number | null>(null)
  const overIndexRef = useRef<number | null>(null)
  const rectsRef = useRef<Array<{ index: number; centerX: number; centerY: number }>>([])
  const transparentDragImageRef = useRef<HTMLImageElement | null>(null)
  const dragOverListenerRef = useRef<((event: DragEvent) => void) | null>(null)
  const dropListenerRef = useRef<((event: DragEvent) => void) | null>(null)
  const dragEndListenerRef = useRef<((event: DragEvent) => void) | null>(null)
  const keydownListenerRef = useRef<((event: KeyboardEvent) => void) | null>(null)

  const sorted = useMemo(() => items, [items])

  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])

  const detachDocumentDragListeners = () => {
    if (dragOverListenerRef.current) {
      document.removeEventListener('dragover', dragOverListenerRef.current)
      dragOverListenerRef.current = null
    }
    if (dropListenerRef.current) {
      document.removeEventListener('drop', dropListenerRef.current)
      dropListenerRef.current = null
    }
    if (dragEndListenerRef.current) {
      document.removeEventListener('dragend', dragEndListenerRef.current)
      dragEndListenerRef.current = null
    }
    if (keydownListenerRef.current) {
      document.removeEventListener('keydown', keydownListenerRef.current)
      keydownListenerRef.current = null
    }
  }

  const finishDrag = () => {
    detachDocumentDragListeners()
    const targetIndex = overIndexRef.current ?? dragState.overIndex

    // Check for foreign drop first
    const foreignAllowed =
      activeDrag &&
      onForeignDrop &&
      activeDrag.itemType === (itemType ?? '') &&
      activeDrag.groupId !== (groupId ?? '') &&
      targetIndex !== null
    if (foreignAllowed && activeDrag && !itemIds.has(activeDrag.id)) {
      handledDragId = activeDrag.id
      onForeignDrop(activeDrag.id, activeDrag.groupId, Math.max(0, targetIndex))
      activeDrag = null
      draggingIdRef.current = null
      dragFromIndexRef.current = null
      overIndexRef.current = null
      window.setTimeout(() => setDragState({ draggingId: null, overIndex: null }), 48)
      return
    }

    // If another list already handled this drag, just reset local state.
    if (handledDragId && draggingIdRef.current === handledDragId && activeDrag === null) {
      draggingIdRef.current = null
      dragFromIndexRef.current = null
      overIndexRef.current = null
      window.setTimeout(() => setDragState({ draggingId: null, overIndex: null }), 48)
      handledDragId = null
      return
    }

    if (draggingIdRef.current === null) return
    const draggingId = draggingIdRef.current ?? dragState.draggingId
    if (draggingId !== null && dragFromIndexRef.current !== null && targetIndex !== null) {
      const fromIndex = dragFromIndexRef.current
      const toIndex = targetIndex
      if (fromIndex !== toIndex && toIndex >= 0 && toIndex <= sorted.length) {
        onReorder(fromIndex, toIndex)
      }
    }
    handledDragId = null
    activeDrag = null
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
    return (best as { index: number; dist: number } | null)?.index ?? null
  }

  const hydrateRects = () => {
    const container = containerRef?.current
    const elements = container
      ? Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-sort-index]'))
      : Array.from(document.querySelectorAll<HTMLElement>('[data-sort-index]'))
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

  const isForeignDragCompatible = () => {
    if (!activeDrag || !itemType) return false
    return activeDrag.itemType === itemType && activeDrag.groupId !== (groupId ?? '')
  }

  const handleDragStart = (id: string, index: number, event: React.DragEvent) => {
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
    activeDrag = { id, itemType: itemType ?? '', groupId: groupId ?? '' }
    draggingIdRef.current = id
    dragFromIndexRef.current = index
    overIndexRef.current = index
    setDragState({ draggingId: id, overIndex: index })
    hydrateRects()
    detachDocumentDragListeners()
    const dragOverHandler = (nativeEvent: DragEvent) => {
      nativeEvent.preventDefault()
      const nearest = computeNearestIndex(nativeEvent.clientX, nativeEvent.clientY)
      if (nearest !== null) {
        overIndexRef.current = nearest
        setDragState((prev) => ({ ...prev, overIndex: nearest }))
      }
    }
    const dropHandler = (nativeEvent: DragEvent) => {
      nativeEvent.preventDefault()
      finishDrag()
    }
    const dragEndHandler = () => {
      finishDrag()
    }
    const keydownHandler = (nativeEvent: KeyboardEvent) => {
      if (nativeEvent.key === 'Escape') {
        finishDrag()
      }
    }

    dragOverListenerRef.current = dragOverHandler
    dropListenerRef.current = dropHandler
    dragEndListenerRef.current = dragEndHandler
    keydownListenerRef.current = keydownHandler

    document.addEventListener('dragover', dragOverHandler, { passive: false })
    document.addEventListener('drop', dropHandler)
    document.addEventListener('dragend', dragEndHandler)
    document.addEventListener('keydown', keydownHandler)
  }

  useEffect(() => {
    return () => {
      detachDocumentDragListeners()
    }
  }, [])

  const getItemProps = (id: string, index: number) => ({
    draggable: !handleOnly,
    'data-sort-id': id,
    'data-sort-index': index,
    onDragStart: (event: React.DragEvent) => {
      if (handleOnly) {
        event.preventDefault()
        return
      }
      handleDragStart(id, index, event)
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault()
      const isLocal = draggingIdRef.current !== null || dragState.draggingId !== null
      const isForeign = isForeignDragCompatible()
      if (!isLocal && !isForeign) return
      const nearest = computeNearestIndex(event.clientX, event.clientY)
      const nextIndex = nearest ?? index
      overIndexRef.current = nextIndex
      setDragState((prev) => ({ ...prev, overIndex: nextIndex }))
    },
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault()
      const isLocal = draggingIdRef.current !== null || dragState.draggingId !== null
      const isForeign = isForeignDragCompatible()
      if (!isLocal && !isForeign) return
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
    draggable: true,
    'data-sort-id': id,
    tabIndex: 0,
    role: 'button',
    'aria-grabbed': dragState.draggingId === id,
    onDragStart: (event: React.DragEvent) => {
      handleDragStart(id, index, event)
    },
    onDragEnd: () => {
      finishDrag()
    },
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
