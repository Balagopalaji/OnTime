import { describe, expect, it } from 'vitest'
import { readViewerConfig } from './config.js'

describe('readViewerConfig', () => {
  it.each([
    ['https://ontime.app', 'https://ontime.app'],
    ['https://ontime.app/', 'https://ontime.app'],
    ['https://ontime.app/some/path?x=1#y', 'https://ontime.app'],
    ['http://localhost:5173', 'http://localhost:5173'],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173'],
  ])('normalises %s to the origin %s', (raw, origin) => {
    expect(readViewerConfig({ ONTIME_WEB_ORIGIN: raw })).toEqual({ webOrigin: origin })
  })

  it.each([undefined, '', 'not a url', 'http://ontime.app', 'ftp://ontime.app', 'file:///tmp', 'javascript:1', 'https://u:p@ontime.app'])(
    'is unconfigured (null) for %j',
    (raw) => {
      expect(readViewerConfig({ ONTIME_WEB_ORIGIN: raw })).toBeNull()
    },
  )
})
