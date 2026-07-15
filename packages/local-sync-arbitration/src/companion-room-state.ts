// rebuild-target: packages/local-sync-arbitration
import type { Room } from '@ontime/shared-types'
import type { CompanionRoomState } from '@ontime/interface-contracts'

export const DEFAULT_ROOM_CONFIG = {
  warningSec: 120,
  criticalSec: 30,
}

export const DEFAULT_FEATURES = {
  localMode: true,
  showControl: false,
  powerpoint: true,
  externalVideo: false,
}

export const DEFAULT_ROOM_STATE: Room['state'] = {
  activeTimerId: null,
  isRunning: false,
  startedAt: null,
  elapsedOffset: 0,
  progress: {},
  showClock: false,
  clockMode: '24h',
  message: {
    text: '',
    visible: false,
    color: 'green',
  },
  currentTime: 0,
  lastUpdate: 0,
}

export const translateCompanionStateToFirebase = (
  companion: CompanionRoomState,
  fallbackState?: Room['state'],
): Room['state'] => {
  const base = fallbackState ?? DEFAULT_ROOM_STATE
  // Companion reports currentTime as elapsed-at-lastUpdate; align startedAt with lastUpdate for UI math.
  const startedAt = companion.isRunning ? companion.lastUpdate : null
  const message = companion.message ? { ...base.message, ...companion.message } : base.message
  return {
    ...base,
    activeTimerId: companion.activeTimerId ?? null,
    isRunning: companion.isRunning,
    startedAt,
    elapsedOffset: companion.currentTime,
    currentTime: companion.currentTime,
    lastUpdate: companion.lastUpdate,
    showClock: companion.showClock ?? base.showClock,
    message,
    activeLiveCueId: companion.activeLiveCueId ?? base.activeLiveCueId,
  }
}

export const buildRoomFromCompanion = (
  roomId: string,
  companionState: CompanionRoomState,
  baseRoom?: Room,
  fallbackOwnerId?: string,
): Room => {
  const base: Room =
    baseRoom ?? {
      id: roomId,
      ownerId: fallbackOwnerId ?? 'local',
      title: 'Local Room',
      timezone: 'UTC',
      createdAt: Date.now(),
      order: 0,
      config: DEFAULT_ROOM_CONFIG,
      state: DEFAULT_ROOM_STATE,
      tier: 'basic',
      features: DEFAULT_FEATURES,
      _version: 1,
    }

  return {
    ...base,
    title: companionState.title ?? base.title,
    timezone: companionState.timezone ?? base.timezone,
    config: base.config ?? DEFAULT_ROOM_CONFIG,
    features: base.features ?? DEFAULT_FEATURES,
    state: translateCompanionStateToFirebase(companionState, base.state),
  }
}

const buildDefaultCompanionState = (): CompanionRoomState => ({
  activeTimerId: null,
  isRunning: false,
  currentTime: 0,
  lastUpdate: Date.now(),
  showClock: false,
  message: {
    text: '',
    visible: false,
    color: 'green',
  },
})

/**
 * Adapter: cloud/Firebase Room state -> Companion clock-domain projection.
 *
 * Cloud `Room.state` is anchored on `startedAt`/`elapsedOffset` (wall-clock
 * anchor); the companion projection is anchored on `currentTime`/`lastUpdate`
 * (elapsed-at-wall-clock). The two shapes are NOT structurally assignable, so
 * the previous `room.state as RoomState` seed cast was a structural lie
 * (it produced an object missing the required `currentTime`/`lastUpdate`
 * companion fields). This adapter performs the explicit, lossless conversion
 * both seed and emit paths need.
 *
 * `currentTime` is computed by the caller (via `computeCurrentTimeWithProgress`)
 * so this helper stays pure and free of timer-math duplication. The emitted
 * payload shape is preserved exactly: no `startedAt`, no `clockMode`.
 */
export const toCompanionRoomState = (
  room: Room,
  currentTime: number,
): CompanionRoomState => ({
  activeTimerId: room.state.activeTimerId ?? null,
  isRunning: room.state.isRunning ?? false,
  currentTime,
  lastUpdate: room.state.lastUpdate ?? Date.now(),
  showClock: room.state.showClock ?? false,
  message: room.state.message,
  title: room.title,
  timezone: room.timezone,
})

export { buildDefaultCompanionState }
