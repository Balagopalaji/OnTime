import type {
  ControllerClient,
  ControllerLock,
  Cue,
  LiveCue,
  Room,
  RoomState,
  Timer,
} from './index'

export const timerFixture = {
  id: 'timer-1',
  roomId: 'room-1',
  title: 'Welcome',
  duration: 300,
  originalDuration: 300,
  type: 'countdown',
  order: 1,
  adjustmentLog: [
    {
      timestamp: 1_700_000_000_000,
      delta: -5_000,
      deviceId: 'controller-1',
      reason: 'manual',
    },
  ],
} satisfies Timer

export const roomStateFixture = {
  activeTimerId: 'timer-1',
  isRunning: true,
  startedAt: 1_700_000_000_000,
  elapsedOffset: -3_000,
  currentTime: -3_000,
  lastUpdate: 1_700_000_001_000,
  progress: {
    'timer-1': -3_000,
  },
  showClock: false,
  clockMode: '24h',
  message: {
    text: 'Stand by',
    visible: true,
    color: 'yellow',
  },
} satisfies RoomState

export const roomFixture = {
  id: 'room-1',
  ownerId: 'owner-1',
  title: 'Sunday Service',
  timezone: 'Australia/Sydney',
  createdAt: 1_700_000_000_000,
  config: {
    warningSec: 60,
    criticalSec: 15,
  },
  state: roomStateFixture,
  tier: 'production',
  features: {
    localMode: true,
    showControl: false,
    powerpoint: true,
    externalVideo: true,
  },
  _version: 1,
} satisfies Room

export const cueFixture = {
  id: 'cue-1',
  roomId: 'room-1',
  role: 'sm',
  title: 'Walk in',
  triggerType: 'timed',
  offsetMs: 30_000,
  timeBase: 'actual',
  ackState: 'pending',
  createdBy: 'operator-1',
} satisfies Cue

export const liveCueFixture = {
  id: 'live-cue-1',
  source: 'powerpoint',
  title: 'Opening deck',
  duration: 120_000,
  status: 'playing',
  metadata: {
    slideNumber: 3,
    totalSlides: 20,
    videos: [
      {
        id: 1,
        name: 'bumper.mp4',
        duration: 30_000,
        elapsed: 10_000,
        remaining: 20_000,
        playing: true,
        status: 'playing',
      },
    ],
  },
} satisfies LiveCue

export const lockFixture = {
  clientId: 'controller-1',
  roomId: 'room-1',
  lockedAt: 1_700_000_000_000,
  lastHeartbeat: 1_700_000_001_000,
} satisfies ControllerLock

export const controllerClientFixture = {
  clientId: 'viewer-1',
  clientType: 'viewer',
  source: 'cloud',
} satisfies ControllerClient
