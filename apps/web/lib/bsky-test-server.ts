import sharp from 'sharp'
import type { BlobRef } from './repo'
import type { HomeServer } from './bsky-profile'

/** A mock home server for tests: one Bluesky profile record, a blob store, and the three XRPC calls this feature makes. Never touches the network. */
export function mockHomeServer(opts: { did?: string; serverUrl?: string; profile?: Record<string, unknown> | null; scope?: string; failWith?: Record<string, number> } = {}) {
  const did = opts.did ?? 'did:plc:alice'
  let profile: { cid: string; value: Record<string, unknown> } | null = opts.profile === null ? null : { cid: 'cid-v1', value: opts.profile ?? { $type: 'app.bsky.actor.profile', displayName: 'Alice' } }
  const blobs = new Map<string, { bytes: Uint8Array; mime: string }>()
  const serverUrl = opts.serverUrl ?? 'https://pds.test'
  /** The origin every call went to. A relative path resolves to the session's own server; an absolute URL would show another host here. */
  const origins = new Set<string>()
  const calls: { nsid: string; body?: unknown }[] = []
  let version = 1
  let blobCount = 0
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const server: HomeServer & { getTokenInfo(): Promise<{ scope: string }> } = {
    did,
    async getTokenInfo() {
      return { scope: opts.scope ?? 'atproto repo:app.bsky.actor.profile?action=update blob:image/*' }
    },
    async fetchHandler(pathname, init) {
      const url = new URL(pathname, serverUrl)
      origins.add(url.origin)
      const nsid = url.pathname.replace('/xrpc/', '')
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ nsid, ...(body ? { body } : {}) })
      const status = opts.failWith?.[nsid]
      if (status) return json(status, { error: status === 403 ? 'AuthMissing' : 'InternalServerError' })
      if (nsid === 'com.atproto.repo.getRecord') return profile ? json(200, { uri: `at://${did}/app.bsky.actor.profile/self`, cid: profile.cid, value: profile.value }) : json(400, { error: 'RecordNotFound' })
      if (nsid === 'com.atproto.repo.uploadBlob') {
        const bytes = new Uint8Array(init!.body as Uint8Array)
        const cid = `blob-${++blobCount}`
        const mime = String((init!.headers as Record<string, string>)['content-type'])
        blobs.set(cid, { bytes, mime })
        return json(200, { blob: { $type: 'blob', ref: { $link: cid }, mimeType: mime, size: bytes.byteLength } })
      }
      if (nsid === 'com.atproto.repo.putRecord') {
        if (body.swapRecord !== profile?.cid) return json(400, { error: 'InvalidSwap' })
        for (const ref of [body.record.avatar as BlobRef | undefined]) if (ref && !blobs.has(ref.ref.$link)) return json(400, { error: 'InvalidBlob' })
        profile = { cid: `cid-v${++version}`, value: body.record }
        return json(200, { uri: `at://${did}/app.bsky.actor.profile/self`, cid: profile.cid })
      }
      if (nsid === 'com.atproto.sync.getBlob') {
        const b = blobs.get(url.searchParams.get('cid') ?? '')
        return b ? new Response(Buffer.from(b.bytes), { status: 200, headers: { 'content-type': b.mime } }) : json(400, { error: 'BlobNotFound' })
      }
      return json(404, { error: 'MethodNotImplemented' })
    },
  }
  return {
    server,
    calls,
    origins,
    blobs,
    writes: () => calls.filter((c) => c.nsid === 'com.atproto.repo.putRecord'),
    profile: () => profile,
    /** The user edits their profile on Bluesky, which changes its version. */
    editElsewhere: (patch: Record<string, unknown>) => {
      profile = { cid: `cid-v${++version}`, value: { ...profile!.value, ...patch } }
    },
    putBlob(cid: string, bytes: Uint8Array, mime = 'image/jpeg'): BlobRef {
      blobs.set(cid, { bytes, mime })
      return { $type: 'blob', ref: { $link: cid }, mimeType: mime, size: bytes.byteLength }
    },
  }
}

export async function testJpeg(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#3366cc' } }).jpeg().toBuffer())
}
