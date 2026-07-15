// rebuild-target: packages/local-sync-arbitration
import type { Cue, Timer } from '@ontime/shared-types'
import type { CompanionRoomState } from '@ontime/interface-contracts'

// Offline-queue coalescing merge carved byte-faithful from
// frontend/src/context/UnifiedDataContext.tsx (Stage 1b U5).

export type QueuedEvent =
  | {
    type: 'TIMER_ACTION'
    action: 'START' | 'PAUSE' | 'RESET'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
    currentTime?: number // Optional: elapsed time for stored progress when starting
  }
  | {
    type: 'CREATE_TIMER'
    timestamp: number
    roomId: string
    timer: Timer
    clientId: string
  }
  | {
    type: 'UPDATE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    changes: Partial<Omit<Timer, 'id' | 'roomId'>>
    clientId: string
  }
  | {
    type: 'DELETE_TIMER'
    timestamp: number
    roomId: string
    timerId: string
    clientId: string
  }
  | {
    type: 'REORDER_TIMERS'
    timestamp: number
    roomId: string
    timerIds: string[]
    clientId: string
  }
  | {
    type: 'ROOM_STATE_PATCH'
    timestamp: number
    roomId: string
    changes: Partial<CompanionRoomState>
    clientId: string
  }

export const mergeQueuedEvents = (queue: QueuedEvent[]): QueuedEvent[] => {
  const grouped = new Map<string, QueuedEvent[]>()
  const keyFor = (event: QueuedEvent) => {
    switch (event.type) {
      case 'TIMER_ACTION':
        return `TIMER_ACTION:${event.timerId}`
      case 'CREATE_TIMER':
      case 'UPDATE_TIMER':
      case 'DELETE_TIMER':
        return `TIMER_CRUD:${event.type === 'CREATE_TIMER' ? event.timer.id : event.timerId}`
      case 'REORDER_TIMERS':
        return `TIMER_REORDER:${event.roomId}`
      case 'ROOM_STATE_PATCH':
        return `ROOM_STATE_PATCH:${event.roomId}`
      default:
        return 'UNKNOWN'
    }
  }

  queue.forEach((event) => {
    const key = keyFor(event)
    const list = grouped.get(key) ?? []
    list.push(event)
    grouped.set(key, list)
  })

  const merged: QueuedEvent[] = []
  grouped.forEach((events) => {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
    const latest = sorted[sorted.length - 1]

    if (latest.type === 'ROOM_STATE_PATCH') {
      merged.push(latest)
      return
    }

    const deletes = sorted.filter((event) => event.type === 'DELETE_TIMER') as Array<
      Extract<QueuedEvent, { type: 'DELETE_TIMER' }>
    >
    if (deletes.length) {
      merged.push(deletes[deletes.length - 1])
      return
    }

    const creates = sorted.filter((event) => event.type === 'CREATE_TIMER') as Array<
      Extract<QueuedEvent, { type: 'CREATE_TIMER' }>
    >
    const updates = sorted.filter((event) => event.type === 'UPDATE_TIMER') as Array<
      Extract<QueuedEvent, { type: 'UPDATE_TIMER' }>
    >

    if (creates.length) {
      const create = creates[creates.length - 1]
      const update = updates[updates.length - 1]
      if (update) {
        const mergedTimer = { ...create.timer, ...(update.changes as Partial<Timer>) }
        const useUpdate = update.timestamp >= create.timestamp
        merged.push({
          ...create,
          timer: mergedTimer,
          timestamp: Math.max(create.timestamp, update.timestamp),
          clientId: useUpdate ? update.clientId : create.clientId,
        })
        return
      }
      merged.push(create)
      return
    }

    merged.push(latest)
  })

  return merged.sort((a, b) => a.timestamp - b.timestamp)
}

export type CueQueuedEvent =
  | {
    type: 'CREATE_CUE'
    timestamp: number
    roomId: string
    cue: Cue
    clientId: string
  }
  | {
    type: 'UPDATE_CUE'
    timestamp: number
    roomId: string
    cueId: string
    changes: Partial<Cue>
    clientId: string
  }
  | {
    type: 'DELETE_CUE'
    timestamp: number
    roomId: string
    cueId: string
    clientId: string
  }
  | {
    type: 'REORDER_CUES'
    timestamp: number
    roomId: string
    cueIds: string[]
    clientId: string
  }

export const mergeCueQueueEvents = (queue: CueQueuedEvent[]): CueQueuedEvent[] => {
  const grouped = new Map<string, CueQueuedEvent[]>()
  const keyFor = (event: CueQueuedEvent) => {
    switch (event.type) {
      case 'CREATE_CUE':
      case 'UPDATE_CUE':
      case 'DELETE_CUE':
        return `CUE:${event.type === 'CREATE_CUE' ? event.cue.id : event.cueId}`
      case 'REORDER_CUES':
        return `CUE_REORDER:${event.roomId}`
      default:
        return 'UNKNOWN'
    }
  }

  queue.forEach((event) => {
    const key = keyFor(event)
    const list = grouped.get(key) ?? []
    list.push(event)
    grouped.set(key, list)
  })

  const merged: CueQueuedEvent[] = []
  grouped.forEach((events) => {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
    const latest = sorted[sorted.length - 1]

    const deletes = sorted.filter((event) => event.type === 'DELETE_CUE') as Array<
      Extract<CueQueuedEvent, { type: 'DELETE_CUE' }>
    >
    if (deletes.length) {
      merged.push(deletes[deletes.length - 1])
      return
    }

    const creates = sorted.filter((event) => event.type === 'CREATE_CUE') as Array<
      Extract<CueQueuedEvent, { type: 'CREATE_CUE' }>
    >
    const updates = sorted.filter((event) => event.type === 'UPDATE_CUE') as Array<
      Extract<CueQueuedEvent, { type: 'UPDATE_CUE' }>
    >

    if (creates.length) {
      const create = creates[creates.length - 1]
      const update = updates[updates.length - 1]
      if (update) {
        const mergedCue = { ...create.cue, ...(update.changes as Partial<Cue>) }
        const useUpdate = update.timestamp >= create.timestamp
        merged.push({
          ...create,
          cue: mergedCue,
          timestamp: Math.max(create.timestamp, update.timestamp),
          clientId: useUpdate ? update.clientId : create.clientId,
        })
        return
      }
      merged.push(create)
      return
    }

    merged.push(latest)
  })

  return merged.sort((a, b) => a.timestamp - b.timestamp)
}
