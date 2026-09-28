import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLLECTIONS } from './config'

const root = path.resolve(__dirname, '../../..')
const firebaseJson = JSON.parse(readFileSync(path.join(root, 'firebase.json'), 'utf8'))
const indexes = JSON.parse(readFileSync(path.join(root, firebaseJson.firestore.indexes), 'utf8'))
type Override = { collectionGroup: string; fieldPath: string; ttl?: boolean; indexes: unknown[] }
const overrides: Override[] = indexes.fieldOverrides
const find = (collectionGroup: string, fieldPath: string) =>
  overrides.find((o) => o.collectionGroup === collectionGroup && o.fieldPath === fieldPath)

describe('presentation Firestore TTL and index config', () => {
  const SWEEP_OWNED = [COLLECTIONS.sessions, COLLECTIONS.devices]

  it.each(Object.values(COLLECTIONS).filter((c) => !SWEEP_OWNED.includes(c as never) && c !== COLLECTIONS.rateLimits))(
    '%s has a TTL policy on cleanupAfterMs that keeps the cleanup query indexed',
    (collection) => {
      // Defect: a leaf collection relies solely on the scheduled sweep; removing the
      // index would break the `cleanupAfterMs <=` cleanup query.
      const ttl = find(collection, 'cleanupAfterMs')
      expect(ttl?.ttl).toBe(true)
      expect(ttl?.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION' })
    },
  )

  it.each(SWEEP_OWNED)('%s is left to the scheduled sweep (no TTL) so its Auth principals are always deleted', (collection) => {
    // Defect: TTL deletes the document first and its ppv_/ppd_ Auth users are orphaned.
    const override = find(collection, 'cleanupAfterMs')
    expect(override?.ttl).not.toBe(true)
    expect(override?.indexes).toContainEqual({ order: 'ASCENDING', queryScope: 'COLLECTION' })
  })

  it('rate-limit buckets are TTL-only with no index on cleanupAfterMs', () => {
    // Defect: every per-second bucket write pays for indexes no query uses.
    expect(find(COLLECTIONS.rateLimits, 'cleanupAfterMs')).toMatchObject({ ttl: true, indexes: [] })
  })

  it.each([
    [COLLECTIONS.snapshots, 'snapshot'],
    [COLLECTIONS.sessions, 'lastSequence'],
    [COLLECTIONS.sessions, 'lastPublishAtMs'],
    [COLLECTIONS.sessions, 'lastPublishRequestHash'],
    [COLLECTIONS.sessions, 'lastPublishResult'],
    [COLLECTIONS.viewerStates, 'lastPublishAtMs'],
  ])('%s.%s is exempt from indexing (high-churn, never queried)', (collection, field) => {
    // Defect: every 10 s heartbeat pays index writes on fields no query uses.
    expect(find(collection, field)?.indexes).toEqual([])
  })
})
