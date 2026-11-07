import WebSocket from 'ws'
import { IdResolver } from '@atproto/identity'
import { cborDecodeMulti } from '@atproto/common'
import type { Label, LabelFrame, LabelSource } from './labels.js'

/**
 * Real com.atproto.label.subscribeLabels client. Event stream framing: each binary message is two
 * DAG-CBOR values, a header {op, t} then a body. https://atproto.com/specs/event-stream
 * Endpoint comes from the labeler's DID document service entry `#atproto_labeler`.
 * https://atproto.com/specs/label
 */
export async function labelerEndpoint(did: string, resolver = new IdResolver({})): Promise<string> {
  const doc = await resolver.did.resolve(did)
  const svc = doc?.service?.find((s) => s.id === '#atproto_labeler' || s.id === `${did}#atproto_labeler`)
  if (!svc || typeof svc.serviceEndpoint !== 'string') throw new Error('labeler service endpoint not found in DID document')
  return svc.serviceEndpoint
}

/** Parses one stream message. Returns null for non-label frames; throws on an error frame. */
export function parseLabelMessage(data: Uint8Array): LabelFrame | null {
  const [header, body] = cborDecodeMulti(data) as [{ op?: number; t?: string }, Record<string, unknown>]
  if (header?.op === -1) throw new Error(`label stream error: ${String((body as { error?: unknown })?.error ?? 'unknown')}`)
  if (header?.t !== '#labels' || typeof body?.seq !== 'number' || !Array.isArray(body.labels)) return null
  return { seq: body.seq, labels: body.labels as Label[] }
}

export function wsLabelSource(did: string, resolver = new IdResolver({})): LabelSource {
  return async function* (cursor) {
    const base = await labelerEndpoint(did, resolver)
    const url = new URL('/xrpc/com.atproto.label.subscribeLabels', base.replace(/^http/, 'ws'))
    url.searchParams.set('cursor', String(cursor))
    const ws = new WebSocket(url)
    const queue: (LabelFrame | Error | 'end')[] = []
    let wake: (() => void) | null = null
    const push = (x: LabelFrame | Error | 'end') => { queue.push(x); wake?.(); wake = null }
    ws.on('message', (d: Buffer) => {
      try { const f = parseLabelMessage(d); if (f) push(f) } catch (e) { push(e as Error) }
    })
    ws.on('error', (e) => push(e))
    ws.on('close', () => push('end'))
    try {
      for (;;) {
        while (queue.length === 0) await new Promise<void>((r) => (wake = r))
        const next = queue.shift()!
        if (next === 'end') return
        if (next instanceof Error) throw next
        yield next
      }
    } finally {
      ws.terminate()
    }
  }
}
