import assert from 'node:assert/strict'
import test from 'node:test'
import fixtures from './fixtures/presentation/event-fixtures.json'

type Fixture = any
type EmitEntry = { roomId: string; event: string; payload: unknown }

const loadHelpers = async () => {
  process.env.ONTIME_COMPANION_DISABLE_BOOTSTRAP = '1'
  process.env.HOME = '/tmp/ontime-companion-presentation-fixtures'
  return import('./main.js')
}

const cueEvents = new Set([
  'LIVE_CUE_CREATED',
  'LIVE_CUE_UPDATED',
  'LIVE_CUE_ENDED',
  'PRESENTATION_LOADED',
  'PRESENTATION_UPDATE',
  'PRESENTATION_CLEAR',
])

function capture(m: any): EmitEntry[] {
  const emitted: EmitEntry[] = []
  m.ioServers.length = 0
  m.ioServers.push({
    to: (roomId: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ roomId, event, payload }),
    }),
  })
  return emitted
}

function seed(m: any, roomId: string) {
  m.roomStateStore.set(roomId, {
    activeTimerId: null,
    isRunning: false,
    currentTime: 0,
    lastUpdate: 0,
    activeLiveCueId: undefined,
    showClock: false,
  })
}

function reset(m: any) {
  m.ioServers.length = 0
  m.roomStateStore.clear()
  m.roomClientStore.clear()
  m.commitPresentationSnapshot(null)
}

function snapshot(value: any) {
  return JSON.parse(JSON.stringify(value))
}

function cueEventsOnly(entries: EmitEntry[]) {
  return entries.filter((entry) => cueEvents.has(entry.event))
}

function expectedEvents(entries: any[]): EmitEntry[] {
  return entries.map(([roomId, event, payload]) => ({ roomId, event, payload }))
}

async function commit(m: any, initial: any, changed: any, initialTimestamp: number, timestamp: number, rooms: string[]) {
  const originalNow = Date.now
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
  let now = initialTimestamp
  Date.now = () => now
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  try {
    reset(m)
    for (const roomId of rooms) seed(m, roomId)
    const emitted = capture(m)
    m.commitPresentationSnapshot(initial)
    if (changed === undefined) return emitted
    emitted.length = 0
    now = timestamp
    m.commitPresentationSnapshot(changed)
    return emitted
  } finally {
    Date.now = originalNow
    Object.defineProperty(process, 'platform', originalPlatform)
  }
}

test('Stage 0 fixture replay preserves complete ordered Companion event payloads', async () => {
  const m = await loadHelpers()
  const scenarios: Record<string, Fixture> = (fixtures as any).scenarios

  const first = scenarios.firstAnnouncement
  const firstEmitted = await commit(m, first.snapshot, undefined, first.timestamp, first.timestamp, first.rooms)
  assert.deepStrictEqual(cueEventsOnly(firstEmitted), expectedEvents(first.events))

  const update = scenarios.update
  const updateEmitted = await commit(m, update.initial, update.changed, update.initialTimestamp, update.timestamp, update.rooms)
  assert.deepStrictEqual(cueEventsOnly(updateEmitted), expectedEvents(update.events))

  const switchCase = scenarios.instanceSwitch
  const switchEmitted = await commit(m, switchCase.old, switchCase.newer, switchCase.initialTimestamp, switchCase.timestamp, switchCase.rooms)
  assert.deepStrictEqual(cueEventsOnly(switchEmitted), expectedEvents(switchCase.events))

  const clear = scenarios.clear
  const clearEmitted = await commit(m, clear.snapshot, null, clear.initialTimestamp, clear.timestamp, clear.rooms)
  assert.deepStrictEqual(cueEventsOnly(clearEmitted), expectedEvents(clear.events))
})
