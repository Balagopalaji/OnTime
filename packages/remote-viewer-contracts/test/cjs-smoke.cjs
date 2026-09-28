const assert = require('node:assert/strict')
const contracts = require('../dist-cjs/index.js')

// Functions (CommonJS) consume the same strict parsers as viewers.
assert.equal(typeof contracts.parsePublishSnapshotRequestV1, 'function')
assert.equal(typeof contracts.parseRemoteSnapshotV1, 'function')
assert.equal(typeof contracts.computePreCommitTransit, 'function')
assert.equal(contracts.STALE_AFTER_MS, 25_000)
assert.deepEqual(contracts.parseRemoteSnapshotV1({ schemaMajor: 2 }), {
  ok: false,
  error: { code: 'incompatible-version', path: 'schemaMajor' },
})
console.log('remote-viewer-contracts CJS smoke passed')
