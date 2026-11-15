import type { NodeSavedSessionStore, NodeSavedStateStore } from '@atproto/oauth-client-node'
import type pg from 'pg'
import type { PendingCode } from './codes'
import { pgLinks } from './email-links-pg'
import { decideLink, HOLD_MS, type LinkDecision, type LinkFacts } from './email-policy'
import { memoryOauthStores, pgOauthStores } from './oauth-stores'
import { singleton } from './pool'
import { memorySessions, pgSessions, type WebSessions } from './web-sessions'

// Kept so older importers keep working after the split.
export { getPool } from './pool'
export { releaseAllPg } from './email-links-pg'
export { SESSION_TOUCH_MS, type WebSession } from './web-sessions'

export type LinkMethod = 'trusted_pds' | 'code'
/** `emailDomain` is the domain of the linked address, or null for links made before migration 0016. `emailEnc` is the address encrypted (`v1:` envelope), or null for links made before migration 0037. */
export type LinkRow = { emailHash: string; method: LinkMethod; verifiedAt: Date; primary: boolean; emailDomain: string | null; emailEnc: string | null }

export interface Store {
  sessions: WebSessions
  oauthState: NodeSavedStateStore
  oauthSession: NodeSavedSessionStore
  links: {
    /** Primary first, then oldest first. */
    list(did: string): Promise<LinkRow[]>
    /** What a link attempt would face right now. Used before mailing a code. */
    inspect(did: string, emailHash: string): Promise<LinkFacts>
    /**
     * Links the hash to the DID under the ownership policy (spec section 6): one hash, one DID; newest
     * verification wins and the old link is removed in the same transaction; cap of 10 per account;
     * a hash released by another DID is held for 30 days. The first email an account links becomes primary.
     * `emailDomain` (the part after the @, never the address) is stored on the row and refreshed when the owner verifies again.
     */
    link(emailHash: string, did: string, method: LinkMethod, emailMd5?: string, emailEnc?: string, emailDomain?: string): Promise<LinkDecision>
    /** The primary email encrypted at rest for notices, or undefined when none is stored (decrypt with token-crypto). */
    noticeAddress(did: string): Promise<string | undefined>
    /** Unlinks and starts the 30-day hold. Returns false when the DID did not own the hash. */
    remove(did: string, emailHash: string): Promise<boolean>
    /** Makes one of the account's emails primary. False when the DID does not own the hash. */
    setPrimary(did: string, emailHash: string): Promise<boolean>
    /** Account deleted: every link becomes a held hash, pending codes and the stored address are dropped. Returns how many. */
    releaseAll(did: string): Promise<number>
  }
  codes: {
    get(did: string): Promise<PendingCode | undefined>
    put(p: PendingCode): Promise<void>
    setAttempts(did: string, attempts: number): Promise<void>
    delete(did: string): Promise<void>
  }
}

export function memoryStore(clock: () => number = Date.now): Store {
  type MemLink = { did: string; method: LinkMethod; verifiedAt: Date; emailMd5?: string; emailDomain?: string; emailEnc?: string; primary: boolean }
  const links = new Map<string, MemLink>()
  const holds = new Map<string, { did: string; releasedAt: number }>()
  const notice = new Map<string, { emailHash: string; enc: string }>()
  /** Keeps the stored address in step with the primary link: only the current primary's address survives. */
  const reconcile = (did: string, emailHash?: string, enc?: string) => {
    const prim = ownedBy(did).find(([, v]) => v.primary)?.[0]
    if (emailHash) for (const [d, n] of [...notice]) if (n.emailHash === emailHash && d !== did) notice.delete(d)
    if (emailHash && enc && prim === emailHash) notice.set(did, { emailHash, enc })
    else if (notice.get(did)?.emailHash !== prim) notice.delete(did)
  }
  const ownedBy = (did: string) => [...links].filter(([, v]) => v.did === did)
  const promote = (did: string) => {
    if (ownedBy(did).some(([, v]) => v.primary)) return
    const next = ownedBy(did).sort((a, b) => a[1].verifiedAt.getTime() - b[1].verifiedAt.getTime())[0]
    if (next) next[1].primary = true
  }
  const hold = (emailHash: string, did: string) => holds.set(emailHash, { did, releasedAt: clock() })
  const facts = (did: string, emailHash: string): LinkFacts => {
    const cur = links.get(emailHash)
    const h = holds.get(emailHash)
    const until = h && h.did !== did && h.releasedAt + HOLD_MS > clock() ? h.releasedAt + HOLD_MS : undefined
    return { owner: !cur ? 'none' : cur.did === did ? 'self' : 'other', heldByOtherUntil: until, count: ownedBy(did).length }
  }
  const codes = new Map<string, PendingCode>()
  return {
    sessions: memorySessions(clock),
    ...memoryOauthStores(),
    links: {
      async list(did) {
        return ownedBy(did)
          .map(([emailHash, v]) => ({ emailHash, method: v.method, verifiedAt: v.verifiedAt, primary: v.primary, emailDomain: v.emailDomain ?? null, emailEnc: v.emailEnc ?? null }))
          .sort((a, b) => Number(b.primary) - Number(a.primary) || a.verifiedAt.getTime() - b.verifiedAt.getTime())
      },
      async inspect(did, emailHash) {
        return facts(did, emailHash)
      },
      async link(emailHash, did, method, emailMd5, emailEnc, emailDomain) {
        const f = facts(did, emailHash)
        const d = decideLink(f)
        if (!d.ok) return d
        if (f.owner === 'self') {
          const cur = links.get(emailHash)!
          links.set(emailHash, { ...cur, method, verifiedAt: new Date(clock()), emailMd5: emailMd5 ?? cur.emailMd5, emailDomain: emailDomain ?? cur.emailDomain, emailEnc: emailEnc ?? cur.emailEnc })
          reconcile(did, emailHash, emailEnc)
          return d
        }
        const prev = links.get(emailHash)
        links.delete(emailHash)
        if (prev) promote(prev.did)
        links.set(emailHash, { did, method, verifiedAt: new Date(clock()), emailMd5, emailDomain, emailEnc, primary: f.count === 0 })
        holds.delete(emailHash)
        if (prev) reconcile(prev.did)
        reconcile(did, emailHash, emailEnc)
        return d
      },
      async noticeAddress(did) {
        return notice.get(did)?.enc
      },
      async remove(did, emailHash) {
        if (links.get(emailHash)?.did !== did) return false
        links.delete(emailHash)
        hold(emailHash, did)
        promote(did)
        reconcile(did)
        return true
      },
      async setPrimary(did, emailHash) {
        if (links.get(emailHash)?.did !== did) return false
        for (const [, v] of ownedBy(did)) v.primary = false
        links.get(emailHash)!.primary = true
        reconcile(did)
        return true
      },
      async releaseAll(did) {
        const mine = ownedBy(did)
        for (const [h] of mine) {
          links.delete(h)
          hold(h, did)
        }
        codes.delete(did)
        notice.delete(did)
        return mine.length
      },
    },
    codes: {
      async get(did) {
        return codes.get(did)
      },
      async put(p) {
        codes.set(p.did, p)
      },
      async setAttempts(did, attempts) {
        const p = codes.get(did)
        if (p) codes.set(did, { ...p, attempts })
      },
      async delete(did) {
        codes.delete(did)
      },
    },
  }
}

export function pgStore(pool: pg.Pool): Store {
  return {
    sessions: pgSessions(pool),
    ...pgOauthStores(pool),
    links: pgLinks(pool),
    codes: {
      async get(did) {
        const r = await pool.query('SELECT * FROM email_codes WHERE did = $1', [did])
        const x = r.rows[0]
        if (!x) return undefined
        return {
          did: x.did,
          emailHash: x.email_hash,
          emailMd5: x.email_md5 ?? undefined,
          emailEnc: x.email_enc ?? undefined,
          emailDomain: x.email_domain ?? undefined,
          codeHash: x.code_hash,
          masked: x.masked,
          attempts: x.attempts,
          expiresAt: new Date(x.expires_at).getTime(),
          createdAt: new Date(x.created_at).getTime(),
        }
      },
      async put(p) {
        await pool.query(
          `INSERT INTO email_codes (did, email_hash, email_md5, code_hash, masked, attempts, expires_at, created_at, email_enc, email_domain)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)
           ON CONFLICT (did) DO UPDATE SET email_hash = EXCLUDED.email_hash, email_md5 = EXCLUDED.email_md5,
             code_hash = EXCLUDED.code_hash, masked = EXCLUDED.masked, attempts = 0,
             expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at, email_enc = EXCLUDED.email_enc,
             email_domain = EXCLUDED.email_domain`,
          [p.did, p.emailHash, p.emailMd5 ?? null, p.codeHash, p.masked, new Date(p.expiresAt), new Date(p.createdAt), p.emailEnc ?? null, p.emailDomain ?? null],
        )
        // An unconfirmed code (and the encrypted address it carries) never outlives its 15 minutes by much.
        await pool.query('DELETE FROM email_codes WHERE expires_at < now() - interval \'1 hour\'')
      },
      async setAttempts(did, attempts) {
        await pool.query('UPDATE email_codes SET attempts = $2 WHERE did = $1', [did, attempts])
      },
      async delete(did) {
        await pool.query('DELETE FROM email_codes WHERE did = $1', [did])
      },
    },
  }
}

/** Postgres when DATABASE_URL is set, otherwise in-memory (dev only, lost on restart). */
export function getStore(): Store {
  return singleton('__bvStore', pgStore, memoryStore)
}
