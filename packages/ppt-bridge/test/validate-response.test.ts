import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_RESPONSE_BYTES, validatePowerPointResponse } from '../src/index.js'

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8').trim()

describe('validatePowerPointResponse', () => {
  it.each([
    ['powerpoint-not-running.json', 'powerpoint_not_running'],
    ['no-slideshow.json', 'no_slideshow'],
    ['playing.json', 'observation'],
    ['paused.json', 'observation'],
    ['ended.json', 'observation'],
    ['multiple-video.json', 'observation'],
  ])('accepts sanitized native fixture %s', (name, kind) => {
    const result = validatePowerPointResponse(fixture(name))
    expect(result.kind).toBe(kind)
  })

  it('preserves the helper-selected primary relationship without selecting a video', () => {
    const result = validatePowerPointResponse(fixture('multiple-video.json'))
    expect(result.kind).toBe('observation')
    if (result.kind !== 'observation') return
    expect(result.observation.videoElapsed).toBe(3000)
    expect(result.observation.videos?.map((video) => video.id)).toEqual([502, 503])
  })

  it('rejects malformed, empty, primitive, null, and missing-state JSON', () => {
    for (const value of ['{', '', 'null', '[]', '42', '{}']) {
      expect(validatePowerPointResponse(value).kind).toBe(value === '{' || value === '' ? 'invalid_json' : 'invalid_payload')
    }
  })

  it('enforces the one MiB UTF-8 byte limit, including the exact boundary', () => {
    expect(validatePowerPointResponse('x'.repeat(MAX_RESPONSE_BYTES + 1)).kind).toBe('oversized_response')
    const prefix = '{"state":"foreground","title":"'
    const suffix = '"}'
    const exact = `${prefix}${'x'.repeat(MAX_RESPONSE_BYTES - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`
    expect(Buffer.byteLength(exact)).toBe(MAX_RESPONSE_BYTES)
    expect(validatePowerPointResponse(exact).kind).toBe('observation')
    expect(validatePowerPointResponse(`${exact}x`).kind).toBe('oversized_response')
    expect(validatePowerPointResponse(new Uint8Array([123, 34, 115, 116, 97, 116, 101, 34, 58, 34, 110, 111, 110, 101, 34, 125])).kind).toBe('powerpoint_not_running')
  })

  it('redacts unknown fields and pptError while retaining bounded warnings', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      pptActive: false,
      pptError: 'C:\\Users\\private\\deck.pptx',
      secret: 'do-not-return',
      videos: [{ id: 1, elapsed: -1, secret: 'hidden' }, 'bad'],
    }))
    expect(result.kind).toBe('com_unavailable')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(JSON.stringify(result)).not.toContain('do-not-return')
    expect(result.extensions.rootUnknownFieldCount).toBe(1)
    expect(result.extensions.videoUnknownFieldCount).toBe(1)
  })

  it('summarizes unknown fields separately for each video list', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      videos: [{ id: 1, extra: true }],
      editSlideVideos: [{ id: 2, extra: true }],
    }))
    expect(result.kind).toBe('observation')
    expect(result.extensions.videoUnknownFieldCount).toBe(1)
    expect(result.extensions.editSlideVideoUnknownFieldCount).toBe(1)
  })

  it('drops invalid optional fields and invalid video entries', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      slideNumber: -1,
      videoDuration: Infinity,
      videoPlaying: 'yes',
      videos: [{ elapsed: -1 }, null, { status: 'wat' }],
    }))
    expect(result.kind).toBe('observation')
    if (result.kind !== 'observation') return
    expect(result.observation.slideNumber).toBeUndefined()
    expect(result.observation.videos).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('applies COM, not-running, and no-slideshow precedence', () => {
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none', pptActive: false })).kind).toBe('com_unavailable')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none', pptError: 'x' })).kind).toBe('com_unavailable')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none' })).kind).toBe('powerpoint_not_running')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'foreground', inSlideshow: false })).kind).toBe('no_slideshow')
  })
})
