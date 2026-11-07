import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertDatabaseAllowed, assertTargetAllowed, classifyTarget } from './guard.mjs'

test('loopback and staging hosts are allowed', () => {
  assert.equal(classifyTarget('http://127.0.0.1:3001').kind, 'loopback')
  assert.equal(classifyTarget('http://localhost:3001').kind, 'loopback')
  assert.equal(classifyTarget('https://blueyvatar-staging.fly.dev').kind, 'staging')
  assert.equal(classifyTarget('https://staging.blueyvatar.com').kind, 'staging')
})

test('other hosts are refused without --i-know', () => {
  for (const u of ['https://blueyvatar.com', 'https://api.blueyvatar.com', 'https://blueyvatar.fly.dev', 'https://example.org', 'https://notstaging.example.com']) {
    assert.throws(() => assertTargetAllowed(u), /Refusing/)
  }
  assert.equal(assertTargetAllowed('https://blueyvatar.com', true).kind, 'other')
})

test('database guard follows the same rule', () => {
  assert.doesNotThrow(() => assertDatabaseAllowed('postgres://postgres@localhost:5432/x'))
  assert.doesNotThrow(() => assertDatabaseAllowed('postgres://u:p@ep-staging-1.neon.tech/db'))
  assert.throws(() => assertDatabaseAllowed('postgres://u:p@ep-prod-1.neon.tech/db'), /Refusing/)
})
