import { SimpleIndexer } from '@atproto/tap'
import { handleRecord, type IndexWrites } from './handlers.js'

/**
 * Maps Tap events to index writes. `SimpleIndexer` acks an event only after the handler resolves,
 * and the channel never acks an event whose handler threw, so Tap redelivers it. Shared by
 * `index.ts` and the live Tap test (issue #42) so the test exercises the production wiring.
 */
export function createIndexer(db: IndexWrites, onError: (err: Error) => void): SimpleIndexer {
  const indexer = new SimpleIndexer()
  indexer.identity(async (evt) => {
    await db.setRepoStatus(evt.did, evt.handle, evt.isActive, evt.status)
  })
  indexer.record(async (evt) => {
    await handleRecord(
      { did: evt.did, collection: evt.collection, rkey: evt.rkey, cid: evt.cid, action: evt.action, record: evt.record as Record<string, unknown> | undefined },
      db,
    )
  })
  indexer.error(onError)
  return indexer
}
