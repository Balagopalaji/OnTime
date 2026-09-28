import { describe, expect, it, vi } from 'vitest'
import { createAuthPacer, deleteUidsInChunks } from './cleanup'

type Errors = Array<{ index: number; error: { code: string } }>
const ok = (uids: string[], errors: Errors = []) => ({ successCount: uids.length - errors.length, errors })
const deps = (deleteUsers: (uids: string[]) => Promise<ReturnType<typeof ok>>, maxChunks = 10) => ({
  deleteUsers,
  sleep: vi.fn(async () => {}),
  maxChunks,
})

describe('deleteUidsInChunks', () => {
  it('uses 1000-uid chunks paced one call per second across units sharing a pacer', async () => {
    // Defect: one deleteUsers call per session, unpaced, trips the Auth ~1 call/s limit.
    const d = deps(async (chunk) => ok(chunk))
    const pacer = createAuthPacer(d)
    const first = await deleteUidsInChunks(Array.from({ length: 2_500 }, (_, i) => `a${i}`), pacer)
    const second = await deleteUidsInChunks(['b0'], pacer)
    expect(d.sleep.mock.calls).toEqual([[1_100], [1_100], [1_100]])
    expect(first).toMatchObject({ deferred: false, failed: new Set() })
    expect(first.completed.size).toBe(2_500)
    expect(second.completed).toEqual(new Set(['b0']))
  })

  it.each(['auth/quota-exceeded', 'auth/too-many-requests'])('defers on %s with the uids completed so far', async (code) => {
    // Defect: Auth throttling is reported as a failed run instead of backlog.
    let call = 0
    const pacer = createAuthPacer(
      deps(async (chunk) => {
        call += 1
        if (call === 2) throw Object.assign(new Error('throttled'), { code })
        return ok(chunk)
      }),
    )
    const result = await deleteUidsInChunks(Array.from({ length: 1_500 }, (_, i) => `u${i}`), pacer)
    expect(result.deferred).toBe(true)
    expect(result.completed.size).toBe(1_000)
    expect(result.completed.has('u1000')).toBe(false)
  })

  it('isolates per-user failures instead of discarding the whole run', async () => {
    // Defect: one persistently failing uid blocks all session/device cleanup forever.
    const pacer = createAuthPacer(
      deps(async (chunk) => ok(chunk, [{ index: 1, error: { code: 'auth/internal-error' } }, { index: 2, error: { code: 'auth/user-not-found' } }])),
    )
    const result = await deleteUidsInChunks(['a', 'b', 'c', 'd'], pacer)
    expect(result).toEqual({ completed: new Set(['a', 'c', 'd']), failed: new Set(['b']), deferred: false })
  })

  it('stops at the per-run chunk budget shared by all units', async () => {
    const pacer = createAuthPacer(deps(async (chunk) => ok(chunk), 2))
    const first = await deleteUidsInChunks(Array.from({ length: 1_500 }, (_, i) => `a${i}`), pacer)
    const second = await deleteUidsInChunks(['b0'], pacer)
    expect(first).toMatchObject({ deferred: false })
    expect(second).toEqual({ completed: new Set(), failed: new Set(), deferred: true })
  })

  it('reports completed chunks in order so a caller can persist progress', async () => {
    const pacer = createAuthPacer(deps(async (chunk) => ok(chunk)))
    const done: number[] = []
    await deleteUidsInChunks(Array.from({ length: 2_100 }, (_, i) => `a${i}`), pacer, (end) => done.push(end))
    expect(done).toEqual([1_000, 2_000, 2_100])
  })

  it('never advances progress past a chunk that had a failure', async () => {
    // Defect: later clean chunks move the cursor beyond a failed uid, which is then never retried.
    let call = 0
    const pacer = createAuthPacer(
      deps(async (chunk) => {
        call += 1
        return call === 1 ? ok(chunk, [{ index: 5, error: { code: 'auth/internal-error' } }]) : ok(chunk)
      }),
    )
    const done: number[] = []
    const result = await deleteUidsInChunks(Array.from({ length: 2_500 }, (_, i) => `a${i}`), pacer, (end) => done.push(end))
    expect(done).toEqual([])
    expect(result.failed).toEqual(new Set(['a5']))
  })
})
