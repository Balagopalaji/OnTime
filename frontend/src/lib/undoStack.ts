export type TimestampLike = { seconds: number; nanoseconds?: number }

export const toMillis = (value: unknown, fallback: number | null = null): number | null => {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'seconds' in (value as Record<string, unknown>)) {
    const ts = value as TimestampLike
    return ts.seconds * 1000 + Math.floor((ts.nanoseconds ?? 0) / 1_000_000)
  }
  return fallback
}

export type RoomUpdatePatch = Partial<{
  title: string
  timezone: string
}>

export type TimerUpdatePatch = Partial<{
  title: string
  duration: number
  speaker: string
  type: string
  order: number
}>

export type UndoEntry = {
  kind: 'room' | 'timer'
  action: string
  id: string
  roomId: string
  expiresAt: number
  timerId?: string
  before?: unknown
  patch?: unknown
  snapshot?: unknown
}

export type UndoStack = {
  undo: UndoEntry[]
  redo: UndoEntry[]
}

export const pushWithCap = (
  stack: UndoStack,
  entry: UndoEntry,
  cap: number,
): { stack: UndoStack; evicted?: UndoEntry } => {
  const nextUndo = [entry, ...stack.undo]
  let evicted: UndoEntry | undefined
  if (nextUndo.length > cap) {
    evicted = nextUndo.pop()
  }
  return { stack: { undo: nextUndo, redo: [] }, evicted }
}

export const popUndo = (stack: UndoStack): { entry?: UndoEntry; stack: UndoStack } => {
  const [entry, ...rest] = stack.undo
  if (!entry) return { stack }
  return { entry, stack: { undo: rest, redo: stack.redo } }
}

export const popRedo = (stack: UndoStack): { entry?: UndoEntry; stack: UndoStack } => {
  const [entry, ...rest] = stack.redo
  if (!entry) return { stack }
  return { entry, stack: { undo: stack.undo, redo: rest } }
}

export const pushRedo = (stack: UndoStack, entry: UndoEntry, cap: number): UndoStack => {
  const nextRedo = [entry, ...stack.redo].slice(0, cap)
  return { undo: stack.undo, redo: nextRedo }
}

export const persistStack = (key: string, stack: UndoStack) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(stack))
  } catch {
    // ignore
  }
}

export const loadStack = (key: string): UndoStack => {
  if (typeof window === 'undefined') return { undo: [], redo: [] }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return { undo: [], redo: [] }
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.undo) && Array.isArray(parsed.redo)) {
      return { undo: parsed.undo as UndoEntry[], redo: parsed.redo as UndoEntry[] }
    }
  } catch {
    // ignore
  }
  return { undo: [], redo: [] }
}

export const clearStack = (key: string) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
