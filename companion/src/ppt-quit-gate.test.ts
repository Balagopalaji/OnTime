import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPptQuitGate,
  runCompanionShutdown,
  type CompanionShutdownHandles,
  type PptQuitSetTimer,
} from './ppt-quit-gate.js'

// Yield to the microtask queue so async intercept bodies settle without real timers.
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// A timer that arms nothing and never fires; lets the close promise win the race
// deterministically without keeping the test process alive on a real 2s timer.
const neverFireTimer: PptQuitSetTimer = () => undefined

test('quit is prevented until the helper close promise settles', async () => {
  const exits: number[] = []
  let resolveClose!: () => void
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve
  })
  const gate = createPptQuitGate({ exitApp: (code) => exits.push(code), setTimeout: neverFireTimer })

  void gate.intercept(() => closePromise)
  await flush()
  assert.equal(gate.isRunning(), true)
  assert.deepEqual(exits, [], 'exit must not run while the helper close is pending')

  resolveClose()
  await flush()
  assert.deepEqual(exits, [0], 'final quit proceeds once the helper close settles')
})

test('repeated before-quit intercepts run shutdown and exit at most once', async () => {
  const exits: number[] = []
  let shutdownCalls = 0
  let resolveClose!: () => void
  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve
  })
  const gate = createPptQuitGate({
    exitApp: (code) => exits.push(code),
    setTimeout: neverFireTimer,
  })
  const shutdown = (): Promise<unknown> => {
    shutdownCalls += 1
    return closePromise
  }

  const first = gate.intercept(shutdown)
  await flush()
  // Re-entrant before-quit while the first intercept is still awaiting close.
  await gate.intercept(shutdown)
  assert.equal(gate.isRunning(), true)
  assert.equal(shutdownCalls, 1, 'shutdown (cleanup) runs only once')
  assert.deepEqual(exits, [], 'no exit before the close settles')

  resolveClose()
  await first
  assert.deepEqual(exits, [0])
})

test('a rejected helper close cannot hang the quit', async () => {
  const exits: number[] = []
  const gate = createPptQuitGate({ exitApp: (code) => exits.push(code), setTimeout: neverFireTimer })

  await gate.intercept(() => Promise.reject(new Error('helper COM shutdown failed')))
  assert.deepEqual(exits, [0], 'rejection is swallowed so quit still proceeds')
})

test('a synchronous shutdown throw cannot hang the quit', async () => {
  const exits: number[] = []
  const gate = createPptQuitGate({ exitApp: (code) => exits.push(code), setTimeout: neverFireTimer })

  await gate.intercept(() => {
    throw new Error('cleanup blew up')
  })
  assert.deepEqual(exits, [0], 'a throw in shutdown still lets quit proceed')
})

test('a hung helper close is bounded by the shutdown timeout', async () => {
  const exits: number[] = []
  const armed: Array<() => void> = []
  const controllableTimer: PptQuitSetTimer = (handler) => {
    armed.push(handler)
    return undefined
  }
  const gate = createPptQuitGate({
    exitApp: (code) => exits.push(code),
    shutdownTimeoutMs: 2000,
    setTimeout: controllableTimer,
  })

  const pending = gate.intercept(() => new Promise<void>(() => {}))
  await flush()
  assert.equal(armed.length, 1, 'shutdown timeout is armed once')
  assert.deepEqual(exits, [], 'no exit before the timeout fires')

  armed[0]!()
  await pending
  assert.deepEqual(exits, [0], 'timeout forces quit even when the helper close hangs')
})

test('exitApp fires exactly once across settlement and any later intercepts', async () => {
  const exits: number[] = []
  const gate = createPptQuitGate({ exitApp: (code) => exits.push(code), setTimeout: neverFireTimer })

  await gate.intercept(() => Promise.resolve())
  await gate.intercept(() => Promise.resolve())
  assert.deepEqual(exits, [0], 'no double emission / session side effects')
})

test('runCompanionShutdown stops polling first then closes servers/helpers in order', async () => {
  const order: string[] = []
  let resolveProbe!: () => void
  const probePromise = new Promise<void>((resolve) => {
    resolveProbe = resolve
  })

  const handles: CompanionShutdownHandles = {
    stopPowerPointDetectionTimer: () => { order.push('stop-detection') },
    ioServers: [
      { close: () => { order.push('io-0') } },
      { close: () => { order.push('io-1') } },
    ],
    httpServer: { close: () => { order.push('http') } },
    httpsServer: null,
    tokenServerV4: { close: () => { order.push('tok-v4') } },
    tokenServerV6: { close: () => { order.push('tok-v6') } },
    tokenServerTlsV4: null,
    tokenServerTlsV6: { close: () => { order.push('tok-tls-v6') } },
    flushRoomCache: () => { order.push('flush') },
    stopPowerPointHelper: () => { order.push('stop-helper') },
    stopPptProbeHelper: () => {
      order.push('stop-probe')
      return probePromise
    },
  }

  const returned = runCompanionShutdown(handles, 'app quit')
  assert.deepEqual(
    order,
    ['stop-detection', 'io-0', 'io-1', 'http', 'tok-v4', 'tok-v6', 'tok-tls-v6', 'flush', 'stop-helper', 'stop-probe'],
    'stops polling first, then closes servers, flush, helpers; null servers skipped; probe last',
  )
  assert.equal(returned, probePromise, 'returns the helper close promise so quit gates on it')

  resolveProbe()
  await returned
})

test('runCompanionShutdown still stops polling and closes the helper when an earlier cleanup step throws', async () => {
  const originalWarn = console.warn
  const warnings: unknown[][] = []
  console.warn = (...args: unknown[]) => { warnings.push(args) }
  let stopDetectionCalls = 0
  let stopProbeCalls = 0
  try {
    const handles: CompanionShutdownHandles = {
      stopPowerPointDetectionTimer: () => { stopDetectionCalls += 1 },
      ioServers: [],
      httpServer: { close: () => { throw new Error('server already closed (Not running)') } },
      httpsServer: null,
      tokenServerV4: null,
      tokenServerV6: null,
      tokenServerTlsV4: null,
      tokenServerTlsV6: null,
      flushRoomCache: () => {},
      stopPowerPointHelper: () => {},
      stopPptProbeHelper: () => {
        stopProbeCalls += 1
        return Promise.resolve()
      },
    }
    const returned = runCompanionShutdown(handles, 'app quit')
    assert.equal(stopDetectionCalls, 1, 'polling is stopped before the throwing step')
    assert.equal(stopProbeCalls, 1, 'helper close must still run after a cleanup throw')
    assert.equal(warnings.length, 1, 'the cleanup throw is logged once')
    await returned
  } finally {
    console.warn = originalWarn
  }
})
