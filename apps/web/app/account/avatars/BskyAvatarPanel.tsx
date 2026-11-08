import { Button } from '../../../components/Button'
import { FIRST_AUTO_NOTICE, hasBskyPermission, type SyncSession } from '../../../lib/bsky-sync'
import type { SyncState } from '../../../lib/bsky-sync-store'
import { dismissBskyNotice, restoreBskyAvatar, saveBskyAutoSync } from './bsky-actions'

/**
 * The profile avatar section of the avatars page (issue #241): the switch, the undo, and
 * the notice after the first automatic change. The page renders it only when the sign-in scope is switched on
 * (OAUTH_REQUEST_BSKY_PROFILE) or the session already holds the permission.
 */
export default async function BskyAvatarPanel({ session, state, server }: { session: SyncSession; state: SyncState; server: string }) {
  const granted = await hasBskyPermission(session)
  return (
    <section aria-labelledby="bsky-avatar-heading">
      <h2 id="bsky-avatar-heading">Keep your profile avatar in sync</h2>
      {!granted ? (
        <p role="status">
          <a href="/login?next=/account/avatars">Sign in again to allow this.</a> BlueyVatar needs your permission to change the picture on your profile on {server}. It changes nothing else.
        </p>
      ) : (
        <>
          {state.autoNoticePending && (
            <div role="status">
              <p>{FIRST_AUTO_NOTICE}</p>
              <div className="flex gap-2">
                {state.previous !== undefined && (
                  <form action={restoreBskyAvatar}>
                    <Button type="submit">Restore my previous avatar</Button>
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
              <input name="autoSync" type="checkbox" defaultChecked={state.autoSync} /> Keep my avatar on {server} the same as my default image
            </label>
            <p>When this is on, choosing a new default image also changes the picture on your profile on {server}. Nothing else on your profile changes. Images rated R or X are never sent.</p>
            <Button type="submit">Save</Button>
          </form>
          {!state.autoNoticePending && state.previous !== undefined && (
            <form action={restoreBskyAvatar}>
              <Button type="submit">Restore my previous avatar</Button>
            </form>
          )}
        </>
      )}
    </section>
  )
}
