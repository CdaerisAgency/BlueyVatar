import { DEFAULT_NOTICE_PREFS, decryptJson, emailSender, Notifier, pgNoticeDirectory, type NoticeDirectory, type NoticePrefs } from '@blueyvatar/core/verification'
import { getPool, getStore } from './store'
import { resolveHandle } from './viewer'

export interface PrefsDirectory extends NoticeDirectory {
  setPrefs(did: string, p: NoticePrefs): Promise<void>
}

/** No database (local dev): the address comes from the in-memory store and preferences live in memory. */
function memoryDirectory(): PrefsDirectory {
  const prefs = new Map<string, NoticePrefs>()
  return {
    async address(did) {
      const enc = await getStore().links.noticeAddress(did)
      return enc ? decryptJson<string>(enc) : null
    },
    async prefs(did) {
      return prefs.get(did) ?? { ...DEFAULT_NOTICE_PREFS }
    },
    async setPrefs(did, p) {
      prefs.set(did, p)
    },
  }
}

const g = globalThis as { __bvNotices?: PrefsDirectory }

/** Preferences and addresses: Postgres when DATABASE_URL is set, otherwise memory. */
export function getNoticeDirectory(): PrefsDirectory {
  const pool = getPool()
  g.__bvNotices ??= pool ? pgNoticeDirectory(pool) : memoryDirectory()
  return g.__bvNotices
}

export function getNotifier(): Notifier {
  const dir = getNoticeDirectory()
  // The handle for the "Account:" line comes from the account's repo. A failed lookup shows the DID.
  return new Notifier(emailSender(), { address: (d) => dir.address(d), prefs: (d) => dir.prefs(d), handle: resolveHandle })
}
