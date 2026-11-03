/**
 * Writing com.blueyvatar.attestation records to the service repo.
 *
 * Default: LocalAttestationWriter. It writes nothing to any repo. The attestation row in Postgres
 * is the source of truth for delivery, and the record uri is a local placeholder. This is the
 * default so the feature runs without service credentials.
 *
 * Production: set SERVICE_REPO_DID and SERVICE_APP_PASSWORD (an app password for the service
 * account, kept in Infisical) and the writer creates and deletes records in that repo.
 * SERVICE_PDS_URL names its PDS (default https://bsky.social).
 */
import { randomUUID } from 'node:crypto'
import { ATTESTATION_COLLECTION } from './claims'

export type StrongRef = { uri: string; cid: string }
export type AttestationInput = { subject: StrongRef; result: 'verified' | 'failed' | 'revoked'; method: string }

export interface AttestationWriter {
  readonly kind: 'local' | 'atproto'
  write(input: AttestationInput): Promise<StrongRef>
  /** Deletes the record. A uri this writer did not create is ignored. */
  remove(uri: string): Promise<void>
}

export const LOCAL_URI_PREFIX = 'local:attestation/'

export class LocalAttestationWriter implements AttestationWriter {
  readonly kind = 'local' as const
  async write(): Promise<StrongRef> {
    return { uri: `${LOCAL_URI_PREFIX}${randomUUID()}`, cid: 'local' }
  }
  async remove(): Promise<void> {}
}

export class AtprotoAttestationWriter implements AttestationWriter {
  readonly kind = 'atproto' as const
  private jwt?: { token: string; at: number }
  constructor(private cfg: { did: string; password: string; pds: string }, private f: typeof fetch = fetch) {}

  private async token(): Promise<string> {
    // Session tokens last minutes; log in again every 5 minutes.
    if (this.jwt && Date.now() - this.jwt.at < 5 * 60_000) return this.jwt.token
    const r = await this.f(`${this.cfg.pds}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: this.cfg.did, password: this.cfg.password }),
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await r.json().catch(() => ({}))) as { accessJwt?: string }
    if (!r.ok || !j.accessJwt) throw new Error('Service repo login failed')
    this.jwt = { token: j.accessJwt, at: Date.now() }
    return j.accessJwt
  }

  private async call<T>(nsid: string, body: unknown): Promise<T> {
    const r = await this.f(`${this.cfg.pds}/xrpc/${nsid}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.token()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) throw new Error(`Service repo request failed (${r.status})`)
    return (await r.json().catch(() => ({}))) as T
  }

  write(input: AttestationInput): Promise<StrongRef> {
    return this.call<StrongRef>('com.atproto.repo.createRecord', {
      repo: this.cfg.did, collection: ATTESTATION_COLLECTION,
      record: { $type: ATTESTATION_COLLECTION, subject: input.subject, result: input.result, method: input.method, createdAt: new Date().toISOString() },
    })
  }

  async remove(uri: string): Promise<void> {
    const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri)
    if (!m || m[1] !== this.cfg.did || m[2] !== ATTESTATION_COLLECTION) return
    await this.call('com.atproto.repo.deleteRecord', { repo: this.cfg.did, collection: ATTESTATION_COLLECTION, rkey: m[3] })
  }
}

export function attestationWriterFromEnv(env: Record<string, string | undefined> = process.env): AttestationWriter {
  const did = env.SERVICE_REPO_DID
  const password = env.SERVICE_APP_PASSWORD
  if (!did || !password) return new LocalAttestationWriter()
  return new AtprotoAttestationWriter({ did, password, pds: (env.SERVICE_PDS_URL || 'https://bsky.social').replace(/\/+$/, '') })
}

const g = globalThis as { __bvAttest?: AttestationWriter }
export const attestationWriter = (): AttestationWriter => (g.__bvAttest ??= attestationWriterFromEnv())
