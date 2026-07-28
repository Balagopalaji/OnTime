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

  it('retains the sanitized observation on no_slideshow outcomes', () => {
    const result = validatePowerPointResponse(fixture('no-slideshow.json'))
    expect(result.kind).toBe('no_slideshow')
    if (result.kind !== 'no_slideshow') return
    expect(result.observation.state).toBe('foreground')
    expect(result.observation.instanceId).toBeDefined()
    expect(result.observation.inSlideshow).toBe(false)
  })

  it('preserves the helper-selected primary relationship without selecting a video', () => {
    const result = validatePowerPointResponse(fixture('multiple-video.json'))
    expect(result.kind).toBe('observation')
    if (result.kind !== 'observation') return
    expect(result.observation.videoElapsed).toBe(3000)
    expect(result.observation.videos?.map((video) => video.id)).toEqual([502, 503])
    expect(result.observation.protocolVersion).toBe(1)
    expect(result.observation.primaryVideoId).toBe(503)
    expect(result.observation.primaryVideoIndex).toBe(1)
  })

  it('retains the helper product version alongside its protocol version', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground', instanceId: 1, inSlideshow: false,
      protocolVersion: 1, productVersion: '0.1.0-beta.1',
    }))
    expect(result.kind).toBe('no_slideshow')
    if (result.kind !== 'no_slideshow') return
    expect(result.observation).toMatchObject({ protocolVersion: 1, productVersion: '0.1.0-beta.1' })
  })

  it('rejects malformed, empty, primitive, null, and missing-state JSON', () => {
    for (const value of ['{', '', 'null', '[]', '42', '{}']) {
      expect(validatePowerPointResponse(value).kind).toBe(value === '{' || value === '' ? 'invalid_json' : 'invalid_payload')
    }
  })

  it('enforces the one MiB UTF-8 byte limit, including the exact boundary', () => {
    expect(validatePowerPointResponse('x'.repeat(MAX_RESPONSE_BYTES + 1)).kind).toBe('oversized_response')
    const prefix = '{"state":"foreground","instanceId":1,"title":"'
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
      instanceId: 1,
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
      instanceId: 1,
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
      instanceId: 1,
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

  it('preserves canonical affinity metadata on the observation', () => {
    const result = validatePowerPointResponse(fixture('affinity-mismatch.json'))
    expect(result.kind).toBe('observation')
    if (result.kind !== 'observation') return
    expect(result.observation.processCount).toBe(2)
    expect(result.observation.selectedPid).toBe(1234)
    expect(result.observation.comPid).toBe(5678)
    expect(result.observation.affinityMismatch).toBe(true)
  })

  it('accepts affinity fields on a no_slideshow outcome and treats absent comPid as undefined', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      inSlideshow: false,
      instanceId: 1234,
      processCount: 2,
      selectedPid: 1234,
      affinityMismatch: true,
    }))
    expect(result.kind).toBe('no_slideshow')
    if (result.kind !== 'no_slideshow') return
    expect(result.observation.processCount).toBe(2)
    expect(result.observation.selectedPid).toBe(1234)
    expect(result.observation.affinityMismatch).toBe(true)
    expect(result.observation.comPid).toBeUndefined()
  })

  it('rejects malformed affinity field types but keeps the observation valid', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      instanceId: 1,
      inSlideshow: true,
      processCount: 'two',
      affinityMismatch: 'yes',
    }))
    expect(result.kind).toBe('observation')
    if (result.kind !== 'observation') return
    expect(result.observation.processCount).toBeUndefined()
    expect(result.observation.affinityMismatch).toBeUndefined()
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('P0-01 maps a typed critical slideshow COM failure to com_unavailable without returning partial observation data', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'foreground',
      instanceId: 7102,
      protocolVersion: 1,
      pptActive: true,
      inSlideshow: true,
      pptError: 'slideshow_state_unavailable',
    }))
    expect(result.kind).toBe('com_unavailable')
    expect('observation' in result).toBe(false)
  })

  it.each([
    ['foreground', undefined],
    ['foreground', 0],
    ['foreground', -1],
    ['background', 1.5],
    ['background', '7102'],
  ])('P0-02 rejects running state %s with non-positive instanceId %j', (state, instanceId) => {
    expect(validatePowerPointResponse(JSON.stringify({ state, instanceId, inSlideshow: true })).kind).toBe('invalid_payload')
  })

  it('P0-03 rejects protocol-v1 media whose explicit primary is missing, invalid, or contradictory', () => {
    const basePayload = {
      state: 'foreground',
      instanceId: 7105,
      protocolVersion: 1,
      inSlideshow: true,
      videos: [{ id: 10 }, { id: 20 }],
    }
    expect(validatePowerPointResponse(JSON.stringify(basePayload)).kind).toBe('invalid_payload')
    expect(validatePowerPointResponse(JSON.stringify({ ...basePayload, primaryVideoIndex: 2 })).kind).toBe('invalid_payload')
    expect(validatePowerPointResponse(JSON.stringify({ ...basePayload, primaryVideoId: 99 })).kind).toBe('invalid_payload')
    expect(validatePowerPointResponse(JSON.stringify({ ...basePayload, primaryVideoId: 10, primaryVideoIndex: 1 })).kind).toBe('invalid_payload')
    expect(validatePowerPointResponse(JSON.stringify({ ...basePayload, primaryVideoId: 10, primaryVideoIndex: 0 })).kind).toBe('observation')
  })

  it('P2-04 preserves the multi-process warning without requiring comPid', () => {
    const result = validatePowerPointResponse(JSON.stringify({
      state: 'background',
      instanceId: 1234,
      inSlideshow: false,
      processCount: 2,
      selectedPid: 1234,
      affinityMismatch: true,
    }))
    expect(result.kind).toBe('no_slideshow')
    if (result.kind !== 'no_slideshow') return
    expect(result.observation).toMatchObject({ processCount: 2, selectedPid: 1234, affinityMismatch: true })
    expect(result.observation.comPid).toBeUndefined()
  })

  it('applies COM, not-running, and no-slideshow precedence', () => {
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none', pptActive: false })).kind).toBe('com_unavailable')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none', pptError: 'x' })).kind).toBe('com_unavailable')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'none' })).kind).toBe('powerpoint_not_running')
    expect(validatePowerPointResponse(JSON.stringify({ state: 'foreground', instanceId: 1, inSlideshow: false })).kind).toBe('no_slideshow')
  })
})
