import { SimpleIndexer } from '@atproto/tap'
import { handleRecord, type IndexWrites } from './handlers.js'

/** Wraps one event handler (readiness bookkeeping, metrics, error reporting). It must rethrow failures so the event is not acked. */
export type TrackEvent = (type: 'identity' | 'record', id: number, run: () => Promise<void>) => Promise<void>

const passthrough: TrackEvent = (_type, _id, run) => run()

/**
 * Maps Tap events to index writes. `SimpleIndexer` acks an event only after the handler resolves,
 * and the channel never acks an event whose handler threw, so Tap redelivers it. Shared by
 * `index.ts` and the live Tap test (issue #42) so the test exercises the production wiring.
 * `track` lets `index.ts` add readiness and metrics around each handler without changing the ack rule.
 */
export function createIndexer(db: IndexWrites, onError: (err: Error) => void, track: TrackEvent = passthrough): SimpleIndexer {
  const indexer = new SimpleIndexer()
  indexer.identity((evt) => track('identity', evt.id, async () => {
    await db.setRepoStatus(evt.did, evt.handle, evt.isActive, evt.status)
  }))
  indexer.record((evt) => track('record', evt.id, async () => {
    await handleRecord(
      { did: evt.did, collection: evt.collection, rkey: evt.rkey, cid: evt.cid, action: evt.action, record: evt.record as Record<string, unknown> | undefined },
      db,
    )
  }))
  indexer.error(onError)
  return indexer
}
