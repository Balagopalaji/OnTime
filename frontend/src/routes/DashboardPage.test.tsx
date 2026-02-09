import { MemoryRouter } from 'react-router-dom'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '../types'
import { DashboardPage } from './DashboardPage'

const mockUseAuth = vi.fn()
const mockUseAppMode = vi.fn()
const mockUseCompanionConnection = vi.fn()
const mockUseDataContext = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../context/AppModeContext', () => ({
  useAppMode: () => mockUseAppMode(),
}))

vi.mock('../context/CompanionConnectionContext', () => ({
  useCompanionConnection: () => mockUseCompanionConnection(),
}))

vi.mock('../context/DataProvider', () => ({
  useDataContext: () => mockUseDataContext(),
}))

const baseNow = 1_700_000_000_000

type Authority = { source: 'cloud' | 'companion' | 'pending'; lastSyncAt: number }

const createRoom = (overrides: Partial<Room>): Room => ({
  id: 'room-1',
  ownerId: 'user-1',
  title: 'Room One',
  timezone: 'UTC',
  createdAt: baseNow - 10_000,
  order: 1,
  config: { warningSec: 120, criticalSec: 30 },
  state: {
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
    lastUpdate: baseNow - 1_000,
  },
  ...overrides,
})

const buildDataContext = (rooms: Room[], authorityByRoomId: Record<string, Authority | undefined> = {}) => ({
  rooms,
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  createTimer: vi.fn(),
  updateRoomMeta: vi.fn(),
  updateRoomTier: vi.fn(),
  getRoom: (roomId: string) => rooms.find((room) => room.id === roomId),
  getTimers: vi.fn(() => []),
  getControllerLock: vi.fn(() => null),
  getControllerLockState: vi.fn(() => 'authoritative'),
  requestControl: vi.fn(),
  pendingRooms: new Set<string>(),
  pendingRoomPlaceholders: [],
  undoRoomDelete: vi.fn(),
  redoRoomDelete: vi.fn(),
  reorderRoom: vi.fn(),
  migrateRoomToV2: vi.fn(),
  rollbackRoomMigration: vi.fn(),
  subscribeToCompanionRoom: vi.fn(),
  getRoomAuthority: (roomId: string) => authorityByRoomId[roomId],
})

const renderDashboard = async (
  rooms: Room[],
  authorityByRoomId: Record<string, Authority | undefined> = {},
) => {
  mockUseDataContext.mockReturnValue(buildDataContext(rooms, authorityByRoomId))
  await act(async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
  })
}

describe('DashboardPage ownership freshness guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(baseNow)

    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } })
    mockUseAppMode.mockReturnValue({ mode: 'cloud', effectiveMode: 'cloud', setMode: vi.fn() })
    mockUseCompanionConnection.mockReturnValue({ discoverCompanion: vi.fn() })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows rooms owned by current user uid', async () => {
    await renderDashboard([createRoom({ id: 'owned-uid', ownerId: 'user-1', title: 'Owned UID Room' })])

    expect(screen.getByText('Owned UID Room')).toBeInTheDocument()
  })

  it.each(['companion', 'pending'] as const)(
    'shows local-owner rooms when authority=%s and data is fresh',
    async (source) => {
      const room = createRoom({
        id: `local-${source}`,
        ownerId: 'local',
        title: `Local ${source} Fresh`,
        state: {
          ...createRoom({}).state,
          lastUpdate: baseNow - 30_000,
        },
      })

      await renderDashboard([room], {
        [room.id]: { source, lastSyncAt: 0 },
      })

      expect(screen.getByText(room.title)).toBeInTheDocument()
    },
  )

  it('hides local-owner rooms when stale beyond freshness threshold', async () => {
    const room = createRoom({
      id: 'local-stale',
      ownerId: 'local',
      title: 'Local Stale Room',
      state: {
        ...createRoom({}).state,
        lastUpdate: baseNow - 91_000,
      },
    })

    await renderDashboard([room], {
      [room.id]: { source: 'companion', lastSyncAt: 0 },
    })

    expect(screen.queryByText(room.title)).not.toBeInTheDocument()
  })

  it.each([
    ['cloud authority', { source: 'cloud', lastSyncAt: baseNow - 1_000 } as Authority],
    ['no authority', undefined],
  ])('hides local-owner fallback path for %s', async (_label, authority) => {
    const room = createRoom({
      id: authority ? 'local-cloud' : 'local-no-authority',
      ownerId: 'local',
      title: authority ? 'Local Cloud Authority Room' : 'Local No Authority Room',
      state: {
        ...createRoom({}).state,
        lastUpdate: baseNow - 1_000,
      },
    })

    await renderDashboard([room], {
      [room.id]: authority,
    })

    expect(screen.queryByText(room.title)).not.toBeInTheDocument()
  })
})
