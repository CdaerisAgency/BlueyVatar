import { Button } from '../../components/Button'
import type { PushApp } from '../../lib/push-apps'
import { firstAutoNotice } from '../../lib/push-sync'
import type { PushState } from '../../lib/push-store'
import { dismissPushNotice, restorePush } from './actions'

/**
 * The notice after the first automatic push to an app, with the undo, and the undo link while one is saved
 * (issue #241, per app since #298). Used by the integrations page and the avatars page.
 */
export default function PushNotices({ items, from }: { items: { app: PushApp; state: PushState }[]; from: 'integrations' | 'avatars' }) {
  const shown = items.filter(({ state }) => state.autoNoticePending || state.previous !== undefined)
  if (shown.length === 0) return null
  return (
    <section aria-label="Changes made to your profile pictures">
      {shown.map(({ app, state }) => (
        <div key={app.id} role={state.autoNoticePending ? 'status' : undefined}>
          {state.autoNoticePending && <p>{firstAutoNotice(app)}</p>}
          <div className="flex gap-2">
            {state.previous !== undefined && (
              <form action={restorePush}>
                <input type="hidden" name="app" value={app.id} />
                <input type="hidden" name="from" value={from} />
                <Button type="submit">Restore my previous {app.name} picture</Button>
              </form>
            )}
            {state.autoNoticePending && (
              <form action={dismissPushNotice}>
                <input type="hidden" name="app" value={app.id} />
                <input type="hidden" name="from" value={from} />
                <Button type="submit">Dismiss</Button>
              </form>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
