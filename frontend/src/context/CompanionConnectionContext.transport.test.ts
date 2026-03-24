import { describe, expect, it } from 'vitest'
import { buildSocketCandidates } from './CompanionConnectionContext'

describe('buildSocketCandidates', () => {
  it('prefers the current Companion origin when the page is Companion-hosted', () => {
    expect(
      buildSocketCandidates({
        origin: 'https://localhost:4440',
        securePage: true,
        isCompanionHosted: true,
      }),
    ).toEqual(['https://localhost:4440'])
  })

  it('tries secure loopback endpoints first on deployed https pages and falls back to http loopback', () => {
    expect(
      buildSocketCandidates({
        origin: 'https://stagetime-2d3df.web.app',
        securePage: true,
        isCompanionHosted: false,
      }),
    ).toEqual([
      'https://localhost:4440',
      'https://127.0.0.1:4440',
      'https://[::1]:4440',
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'http://[::1]:4000',
    ])
  })
})
