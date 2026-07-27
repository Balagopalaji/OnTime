import { describe, expect, it } from 'vitest'
import { discoverHelperCandidates } from './helper-discovery'

describe('discoverHelperCandidates (safe discovery)', () => {
  it('returns existing candidates and skips missing ones', () => {
    const exists = (p: string) => p === '/dev/ppt-probe.exe'
    const candidates = discoverHelperCandidates({ envPath: '/dev/ppt-probe.exe', resourcesPath: '/res', exists })
    expect(candidates).toEqual([{ executablePath: '/dev/ppt-probe.exe' }])
  })

  it('appends the packaged resourcesPath candidate', () => {
    const exists = (p: string) => p === '/res/ppt-probe.exe'
    const candidates = discoverHelperCandidates({ resourcesPath: '/res', exists })
    expect(candidates).toEqual([{ executablePath: '/res/ppt-probe.exe' }])
  })

  it('returns nothing when no candidate exists (non-Windows / first dev run)', () => {
    const candidates = discoverHelperCandidates({ envPath: '/nope', resourcesPath: '/also-nope', exists: () => false })
    expect(candidates).toEqual([])
  })

  it('never throws even if the existence check throws', () => {
    const candidates = discoverHelperCandidates({ envPath: '/x', exists: () => { throw new Error('denied') } })
    expect(candidates).toEqual([])
  })

  it('ignores empty/undefined paths', () => {
    expect(discoverHelperCandidates({ envPath: '', resourcesPath: '', exists: () => true })).toEqual([])
  })
})
