import { describe, expect, it } from 'vitest'
import { LAN_CONFIG_ARG, parseLanConfig } from './lan-config'

const valid = { companionUrl: 'http://127.0.0.1:4000', roomId: 'room-1' }

describe('LAN startup config', () => {
  it('uses a dedicated startup argument distinct from the cloud config', () => {
    expect(LAN_CONFIG_ARG).toBe('--lan-config=')
  })

  it('accepts a loopback Companion origin and a room ID', () => {
    expect(parseLanConfig(valid)).toEqual(valid)
    expect(parseLanConfig({ ...valid, companionUrl: 'http://localhost:4000' })).toEqual({ ...valid, companionUrl: 'http://localhost:4000' })
    expect(parseLanConfig({ ...valid, companionUrl: 'http://[::1]:4000' })).toEqual({ ...valid, companionUrl: 'http://[::1]:4000' })
  })

  it.each([
    ['a LAN host', { ...valid, companionUrl: 'http://192.168.1.40:4000' }],
    ['a public host', { ...valid, companionUrl: 'http://example.com:4000' }],
    ['https (a self-signed loopback certificate is not trusted by the sidecar)', { ...valid, companionUrl: 'https://127.0.0.1:4440' }],
    ['credentials in the URL', { ...valid, companionUrl: 'http://user:pw@127.0.0.1:4000' }],
    ['a path', { ...valid, companionUrl: 'http://127.0.0.1:4000/x' }],
    ['a query', { ...valid, companionUrl: 'http://127.0.0.1:4000?x=1' }],
    ['a missing port', { ...valid, companionUrl: 'http://127.0.0.1' }],
    ['an unparsable URL', { ...valid, companionUrl: 'nope' }],
    ['an empty room', { ...valid, roomId: '' }],
    ['an over-long room', { ...valid, roomId: 'r'.repeat(129) }],
    ['a padded room (Companion trims, so the token room would differ)', { ...valid, roomId: ' room-1 ' }],
    ['an unknown key', { ...valid, extra: 1 }],
    ['a missing key', { roomId: 'room-1' }],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, input) => {
    expect(parseLanConfig(input)).toBeNull()
  })
})
