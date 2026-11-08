import { Button } from '../../../components/Button'
import { BSKY_MESSAGES } from '../../../lib/bsky-profile'
import { FIRST_AUTO_NOTICE, hasBskyPermission, type SyncSession } from '../../../lib/bsky-sync'
import type { SyncState } from '../../../lib/bsky-sync-store'
import { blobUrl } from '../../../lib/repo'
import { dismissBskyNotice, restoreBskyAvatar, saveBskyAutoSync } from './bsky-actions'

/**
 * The Bluesky avatar section of the avatars page (issue #241): what Bluesky shows now, the switch, the undo, and
 * the notice after the first automatic change. The page renders it only when the sign-in scope is switched on
 * (OAUTH_REQUEST_BSKY_PROFILE) or the session already holds the permission.
 */
export default async function BskyAvatarPanel({ session, state, pds, shownCid }: { session: SyncSession; state: SyncState; pds: string; shownCid: string | null }) {
  const granted = await hasBskyPermission(session)
  return (
    <section aria-labelledby="bsky-avatar-heading">
      <h2 id="bsky-avatar-heading">Your Bluesky avatar</h2>
      {shownCid ? (
        <p className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={blobUrl(pds, session.did, shownCid)} alt="" width={64} height={64} className="object-cover" referrerPolicy="no-referrer" /> This is the picture Bluesky shows now.
        </p>
      ) : (
        <p>Bluesky shows no picture of yours right now.</p>
      )}
      {!granted ? (
        <p role="status">
          {BSKY_MESSAGES.no_permission} <a href="/login?next=/account/avatars">Sign in again</a> to allow it.
        </p>
      ) : (
        <>
          {state.autoNoticePending && (
            <div role="status">
              <p>{FIRST_AUTO_NOTICE}</p>
              <div className="flex gap-2">
                {state.previous !== undefined && (
                  <form action={restoreBskyAvatar}>
                    <Button type="submit">Restore my previous Bluesky avatar</Button>
                  </form>
                )}
                <form action={dismissBskyNotice}>
                  <Button type="submit">Dismiss</Button>
                </form>
              </div>
            </div>
          )}
          <form action={saveBskyAutoSync}>
            <label>
              <input name="autoSync" type="checkbox" defaultChecked={state.autoSync} /> Keep my Bluesky avatar the same as my default image
            </label>
            <p>When this is on, choosing a new default image also changes the picture on your Bluesky profile. Nothing else on your Bluesky profile changes. Images rated R or X are never sent.</p>
            <Button type="submit">Save</Button>
          </form>
          {!state.autoNoticePending && state.previous !== undefined && (
            <form action={restoreBskyAvatar}>
              <Button type="submit">Restore my previous Bluesky avatar</Button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
