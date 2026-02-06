import { describe, expect, it } from 'vitest'
import { canPerformControllerAction } from './controller-permissions'

describe('canPerformControllerAction', () => {
  it('blocks controller actions when viewer-only mode is enabled', () => {
    expect(canPerformControllerAction({ viewerOnly: true, isReadOnly: false })).toBe(false)
  })

  it('blocks controller actions when room is read-only', () => {
    expect(canPerformControllerAction({ viewerOnly: false, isReadOnly: true })).toBe(false)
  })

  it('allows controller actions only when writable and not viewer-only', () => {
    expect(canPerformControllerAction({ viewerOnly: false, isReadOnly: false })).toBe(true)
  })
})
