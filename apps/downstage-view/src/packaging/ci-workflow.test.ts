import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The packaging lane must stay secret-safe and must run the same audit that the
// package-content tests exercise.

const repoRoot = path.resolve(__dirname, '../../../..')
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/downstage-view-build.yml'), 'utf8')
const ciLocal = readFileSync(path.join(repoRoot, 'scripts/ci-local.mjs'), 'utf8')

describe('downstage-view-build.yml (ISSUE-002 S8b)', () => {
  it('is manual or tag-triggered only, with its own tag namespace', () => {
    expect(workflow).toMatch(/workflow_dispatch:/)
    expect(workflow).toMatch(/downstage-view-v\*/)
    expect(workflow).not.toMatch(/^\s+pull_request/m)
    expect(workflow).not.toMatch(/pull_request_target/)
  })

  it('builds macOS on a macOS runner with gates before packaging and an audit after', () => {
    expect(workflow).toMatch(/runs-on:\s*macos-latest/)
    const order = [
      'npm run typecheck --workspace apps/downstage-view',
      'npm run test --workspace apps/downstage-view',
      'npm run dist:mac\n',
      'npm run dist:mac:unsigned',
      'npm run audit:package',
    ].map((needle) => workflow.indexOf(needle))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(order[3]).toBeLessThan(order[4])
  })

  it('reads signing secrets only for the signed packaging step and falls back to unsigned', () => {
    const signedStep = workflow.slice(workflow.indexOf('Package signed and notarized'), workflow.indexOf('Package unsigned'))
    for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
      expect(signedStep).toContain(`secrets.${name}`)
    }
    const outsideSigned = workflow.replace(signedStep, '')
    // Only the presence check (!= '') may mention secrets elsewhere.
    expect(outsideSigned.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.CSC_LINK', 'secrets.CSC_KEY_PASSWORD'])
    expect(workflow).toMatch(/if:\s*env\.HAS_MAC_SIGNING != 'true'/)
  })

  it('keeps the per-commit gate in ci-local', () => {
    expect(ciLocal).toContain('npm run typecheck --workspace apps/downstage-view')
    expect(ciLocal).toContain('npm run test --workspace apps/downstage-view')
  })
})
