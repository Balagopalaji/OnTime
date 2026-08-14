import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { configureProductIdentity, PRODUCT_NAME, resolveUserDataPath } from './product-identity'

describe('Downstage product identity', () => {
  it('uses the accepted public product name', () => {
    expect(PRODUCT_NAME).toBe('Downstage PPT Video Timer')
  })

  it('uses a clean suite-owned settings path without the retired brand', () => {
    const resolved = resolveUserDataPath('C:\\Users\\tester\\AppData\\Roaming')
    expect(path.normalize(resolved)).toBe(
      path.normalize('C:\\Users\\tester\\AppData\\Roaming\\Downstage\\PPT Video Timer'),
    )
    expect(resolved.toLowerCase()).not.toContain('ontime')
  })

  it('sets the public name and creates the new path before selecting userData', async () => {
    const calls: string[] = []
    const app = {
      setName: (name: string) => calls.push(`name:${name}`),
      getPath: (_name: 'appData') => 'C:\\Users\\tester\\AppData\\Roaming',
      setPath: (name: 'userData', value: string) => calls.push(`${name}:${value}`),
    }
    const result = await configureProductIdentity(app, async (value) => {
      calls.push(`mkdir:${value}`)
    })

    expect(result).toBe(resolveUserDataPath(app.getPath('appData')))
    expect(calls).toEqual([
      `name:${PRODUCT_NAME}`,
      `mkdir:${result}`,
      `userData:${result}`,
    ])
  })
})
