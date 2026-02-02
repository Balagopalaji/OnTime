/**
 * Pure utility functions extracted from FirebaseDataContext for testability.
 */
import type { Section, Segment } from '../types'

const toMillis = (val: unknown): number | null => {
  if (typeof val === 'number') return val
  if (val && typeof val === 'object' && 'seconds' in val) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (val as any).seconds * 1000
  }
  return null
}

// ─── Firestore doc shapes ────────────────────────────────────────

export type SectionDoc = {
  title?: string
  order?: number
  notes?: string
  plannedDurationSec?: number
  plannedStartAt?: number
  createdAt?: number | { seconds: number; nanoseconds: number }
  updatedAt?: number | { seconds: number; nanoseconds: number }
}

export type SegmentDoc = {
  sectionId?: string
  title?: string
  order?: number
  plannedStartAt?: number
  plannedDurationSec?: number
  primaryTimerId?: string
  notes?: string
  createdAt?: number | { seconds: number; nanoseconds: number }
  updatedAt?: number | { seconds: number; nanoseconds: number }
}

// ─── Mapping functions ───────────────────────────────────────────

export const mapSection = (id: string, roomId: string, data: SectionDoc): Section => ({
  id,
  roomId,
  title: typeof data.title === 'string' ? data.title : '',
  order: typeof data.order === 'number' ? data.order : 0,
  notes: typeof data.notes === 'string' ? data.notes : undefined,
  plannedDurationSec: typeof data.plannedDurationSec === 'number' ? data.plannedDurationSec : undefined,
  plannedStartAt: typeof data.plannedStartAt === 'number' ? data.plannedStartAt : undefined,
  createdAt: toMillis(data.createdAt) ?? undefined,
  updatedAt: toMillis(data.updatedAt) ?? undefined,
})

export const mapSegment = (id: string, roomId: string, data: SegmentDoc): Segment => ({
  id,
  roomId,
  sectionId: typeof data.sectionId === 'string' ? data.sectionId : undefined,
  title: typeof data.title === 'string' ? data.title : '',
  order: typeof data.order === 'number' ? data.order : 0,
  plannedStartAt: typeof data.plannedStartAt === 'number' ? data.plannedStartAt : undefined,
  plannedDurationSec: typeof data.plannedDurationSec === 'number' ? data.plannedDurationSec : undefined,
  primaryTimerId: typeof data.primaryTimerId === 'string' ? data.primaryTimerId : undefined,
  notes: typeof data.notes === 'string' ? data.notes : undefined,
  createdAt: toMillis(data.createdAt) ?? undefined,
  updatedAt: toMillis(data.updatedAt) ?? undefined,
})

export const stripUndefined = <T extends Record<string, unknown>>(payload: T): Partial<T> =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>
