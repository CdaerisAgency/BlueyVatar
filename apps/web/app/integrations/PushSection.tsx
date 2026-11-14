import { Button } from '../../components/Button'
import { currentDid } from '../../lib/auth'
import { pdsHost } from '../../lib/pds'
import { pushAppsEnabled } from '../../lib/oauth'
import { PUSH_APPS, limitLabel, type PushApp } from '../../lib/push-apps'
import { getPushStore, type PushState } from '../../lib/push-store'
import { rowStatus, type RowStatus } from '../../lib/push-status'
import { hasPushPermission, type SyncSession } from '../../lib/push-sync'
import { pdsUrl, repoSession } from '../../lib/repo'
import { finishPush, savePushChoice } from './actions'
import PushNotices from './PushNotices'

type Row = { app: PushApp; state: PushState; status: RowStatus }

/**
 * "Send your picture to apps" (issue #298): one row per app in push-apps.ts, each with its own checkbox and its own
 * permission step. Signed-out visitors see a sign-in prompt; the rest of the page is public.
 */
export default async function PushSection({ ask }: { ask?: string }) {
  const did = await currentDid()
  const on = pushAppsEnabled()
  return (
    <section aria-labelledby="push-heading">
      <h2 id="push-heading">Send your picture to apps</h2>
      <p>
        Pick the apps that should show your BlueyVatar default image as their profile picture. Each box is off until you tick it. Ticking one asks your Bluesky account&apos;s home server
        for the permission to change that one app&apos;s profile record, and nothing else. The home server is the service that stores your account and everything you post. Images rated R or X are never sent.
      </p>
      {!did ? (
        <p>
          <a href="/login">Sign in</a> to choose.
        </p>
      ) : !on ? (
        <p role="status">Pushing to apps is not switched on yet. Your BlueyVatar links work as they always have.</p>
      ) : (
        <Rows did={did} ask={ask} />
      )}
    </section>
  )
}

async function Rows({ did, ask }: { did: string; ask: string | undefined }) {
  const store = getPushStore()
  let session: SyncSession | null = null
  let host: string | null = null
  try {
    const s = await repoSession(did)
    session = s
    host = pdsHost(await pdsUrl(s))
  } catch {
    // The rows still show; each one explains that its permission could not be checked.
  }
  const rows: Row[] = await Promise.all(
    PUSH_APPS.map(async (app) => {
      const state = await store.get(did, app.id)
      const permitted = session ? await hasPushPermission(session, app) : false
      return { app, state, status: rowStatus(state, permitted) }
    }),
  )
  return (
    <>
      <p>
        The picture is written to your profile record for that app, which lives on the home server{host ? ` (${host})` : ''}. Pushing never changes any other field in the record.
        Unticking a box stops future pushes and leaves the record as it is.
      </p>
      {!session && <p role="alert">Your home server could not be reached, so the state of each box may be out of date. Try again in a few minutes.</p>}
      <PushNotices items={rows} from="integrations" />
      <ul aria-label="Apps that can receive your picture">
        {rows.map((r) => (
          <li key={r.app.id}>
            <AppRow row={r} ask={ask === r.app.id} />
          </li>
        ))}
      </ul>
    </>
  )
}

function AppRow({ row: { app, status }, ask }: { row: Row; ask: boolean }) {
  return (
    <div>
      <h3>
        <a href={app.url} rel="noopener">
          {app.name}
        </a>
      </h3>
      <p>
        Reaches: {app.reach} {app.note}
      </p>
      <p>
        The picture is sent as a square PNG or JPEG of at most {limitLabel(app.avatar.maxBytes)}, shrunk from your original when needed.
      </p>
      {status === 'finish' ? (
        <form action={finishPush}>
          <input type="hidden" name="app" value={app.id} />
          {ask ? (
            <>
              <p role="status">
                Your account has no {app.name} profile record yet. Create one that holds only your picture? Nothing else is added to it. If you say no, nothing is turned
                on.
              </p>
              <input type="hidden" name="create" value="yes" />
              <Button type="submit" variant="primary">
                Create it and turn on {app.name}
              </Button>
            </>
          ) : (
            <>
              <p role="status">You allowed the change. One step is left.</p>
              <Button type="submit" variant="primary">
                Turn on pushing to {app.name}
              </Button>
            </>
          )}{' '}
          <Button type="submit" name="cancel" value="on">
            {ask ? 'No, do not create it' : 'Cancel'}
          </Button>
        </form>
      ) : (
        <form action={savePushChoice}>
          <input type="hidden" name="app" value={app.id} />
          {status === 'declined' && <p role="alert">BlueyVatar did not get permission for {app.name}, so nothing was turned on. Tick the box to try again.</p>}
          {status === 'needs_permission' && (
            <p role="alert">
              BlueyVatar no longer holds the permission for {app.name}, so it cannot push. Signing in again can end it. Save with the box ticked to allow it again.
            </p>
          )}
          <label>
            <input name="push" type="checkbox" defaultChecked={status === 'on' || status === 'needs_permission'} /> Push my BlueyVatar avatar to {app.name}
          </label>{' '}
          <Button type="submit">Save</Button>
        </form>
      )}
    </div>
  )
}
