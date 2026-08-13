import { describe, expect, it } from 'vitest'
import { discoverHelperCandidates } from './helper-discovery'

describe('discoverHelperCandidates (safe discovery)', () => {
  it('returns existing candidates and skips missing ones', () => {
    const exists = (p: string) => p === '/dev/ppt-probe.exe'
    const candidates = discoverHelperCandidates({ envPath: '/dev/ppt-probe.exe', resourcesPath: '/res', exists })
    expect(candidates).toEqual([{ executablePath: '/dev/ppt-probe.exe' }])
  })

  it('resolves the packaged candidate under resources/bin/ppt-probe.exe', () => {
    const exists = (p: string) => p === '/res/bin/ppt-probe.exe'
    const candidates = discoverHelperCandidates({ resourcesPath: '/res', exists })
    expect(candidates).toEqual([{ executablePath: '/res/bin/ppt-probe.exe' }])
  })

  it('does NOT discover a legacy <resources>/ppt-probe.exe (pre-bin) path', () => {
    // The packaged helper lives under resources/bin/ only; the flat path must
    // never resolve even if a file happened to exist there.
    const exists = (p: string) => p === '/res/ppt-probe.exe'
    const candidates = discoverHelperCandidates({ resourcesPath: '/res', exists })
    expect(candidates).toEqual([])
  })

  it('returns nothing when no candidate exists (non-Windows / first dev run)', () => {
    const candidates = discoverHelperCandidates({ envPath: '/nope', resourcesPath: '/also-nope', exists: () => false })
    expect(candidates).toEqual([])
  })

  it('prefers the dev envPath over the packaged bin candidate (dev override wins)', () => {
    const exists = (p: string) => p === '/dev/ppt-probe.exe' || p === '/res/bin/ppt-probe.exe'
    const candidates = discoverHelperCandidates({
      envPath: '/dev/ppt-probe.exe',
      resourcesPath: '/res',
      exists,
    })
    expect(candidates).toEqual([
      { executablePath: '/dev/ppt-probe.exe' },
      { executablePath: '/res/bin/ppt-probe.exe' },
    ])
    expect(candidates[0]?.executablePath).toBe('/dev/ppt-probe.exe')
  })

  it('never throws even if the existence check throws', () => {
    const candidates = discoverHelperCandidates({ envPath: '/x', exists: () => { throw new Error('denied') } })
    expect(candidates).toEqual([])
  })

  it('ignores empty/undefined paths', () => {
    expect(discoverHelperCandidates({ envPath: '', resourcesPath: '', exists: () => true })).toEqual([])
  })
})
