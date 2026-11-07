import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarize } from './stats.mjs'

test('nearest-rank percentiles', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(v, 50), 50)
  assert.equal(percentile(v, 95), 95)
  assert.equal(percentile(v, 99), 99)
  assert.equal(percentile([], 50), null)
  assert.deepEqual(summarize([3, 1, 2]), { n: 3, p50: 2, p95: 3, p99: 3, max: 3 })
})
