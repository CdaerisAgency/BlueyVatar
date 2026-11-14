'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { currentDid, oauthClient, rememberNext } from '../../lib/auth'
import { consentScope, pushAppsEnabled } from '../../lib/oauth'
import { PUSH_APPS, pushApp, type PushApp } from '../../lib/push-apps'
import { disableApp, enableApp, pushToApp, restorePrevious, hasPushPermission, type SyncOutcome } from '../../lib/push-sync'
import { getPushStore } from '../../lib/push-store'
import { syncDeps } from '../../lib/push-server'
import { reportError } from '../../lib/obs'
import { RepoError, listImages, repoSession } from '../../lib/repo'

/** Where an action sends the user back to. The avatars page has buttons that call these actions too. */
const PAGES = { integrations: '/integrations', avatars: '/account/avatars' } as const
type From = keyof typeof PAGES
const fromForm = (form: FormData): From => (form.get('from') === 'avatars' ? 'avatars' : 'integrations')
const back = (from: From, key: 'error' | 'done' | 'ask', value: string): never => redirect(`${PAGES[from]}?${key}=${encodeURIComponent(value)}`)
const finish = (from: From, o: SyncOutcome): never => back(from, o.ok ? 'done' : 'error', o.message)

async function signedIn(): Promise<string> {
  return (await currentDid()) ?? redirect('/login')
}

function appFrom(form: FormData): PushApp | undefined {
  return pushApp(String(form.get('app') ?? ''))
}

const defaultImage = async (did: string) => {
  const session = await repoSession(did)
  return { session, image: (await listImages(session)).find((i) => i.value.isDefault === true) }
}

/**
 * The Save button on an app's row. Unticked turns the app off. Ticked turns it on: when the session already holds the
 * app's permission it goes straight to the last step, otherwise it starts the consent step for this one app.
 */
export async function savePushChoice(form: FormData): Promise<void> {
  const did = await signedIn()
  const app = appFrom(form)
  if (!app) return back('integrations', 'error', 'That app is not on the list.')
  if (!pushAppsEnabled()) return back('integrations', 'error', 'Pushing to apps is not switched on yet.')
  const store = getPushStore()
  if (form.get('push') !== 'on') return back('integrations', 'done', await disableApp({ store }, did, app))
  try {
    const session = await repoSession(did)
    await store.startConsent(did, app.id)
    // Already allowed: no permission screen, so go straight to the last step on the page.
    if (await hasPushPermission(session, app)) return redirect('/integrations')
    // Ask for this app only. The scopes of apps that are already on are listed too, so this grant does not replace them.
    const on = new Set(await store.enabledApps(did))
    const collections = [...PUSH_APPS.filter((a) => on.has(a.id) || a.id === app.id)].map((a) => a.collection)
    await rememberNext('/account/avatars')
    const url = await (await oauthClient()).authorize(did, { scope: consentScope(collections), state: 'login' })
    return redirect(url.toString())
  } catch (err) {
    unstable_rethrow(err) // a redirect inside the try block must pass through
    reportError('integrations consent failed', err)
    await store.clearConsent(did, app.id).catch(() => undefined)
    return back('integrations', 'error', err instanceof RepoError ? err.message : `Could not start the permission step for ${app.name}. Try again.`)
  }
}

/** The last step: turns the app on once the permission is held. `create=yes` is the answer to "create a profile record?". */
export async function finishPush(form: FormData): Promise<void> {
  const did = await signedIn()
  const app = appFrom(form)
  if (!app) return back('integrations', 'error', 'That app is not on the list.')
  if (!pushAppsEnabled()) return back('integrations', 'error', 'Pushing to apps is not switched on yet.')
  if (form.get('cancel') === 'on') {
    await getPushStore().clearConsent(did, app.id)
    return back('integrations', 'done', `Nothing was turned on for ${app.name}.`)
  }
  try {
    const { session, image } = await defaultImage(did)
    const out = await enableApp(session, app, image, syncDeps(did), { create: form.get('create') === 'yes' })
    if (out.kind === 'ask_create') return back('integrations', 'ask', app.id)
    return back('integrations', out.kind === 'enabled' ? 'done' : 'error', out.message)
  } catch (err) {
    unstable_rethrow(err)
    reportError('integrations enable failed', err)
    return back('integrations', 'error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
}

/** The "Push to <app>" button on one image. */
export async function pushImage(form: FormData): Promise<void> {
  const did = await signedIn()
  const from = fromForm(form)
  const app = appFrom(form)
  if (!app) return back(from, 'error', 'That app is not on the list.')
  let outcome: SyncOutcome
  try {
    const session = await repoSession(did)
    const image = (await listImages(session)).find((i) => i.rkey === String(form.get('rkey') ?? ''))
    if (!image) return back(from, 'error', 'That image no longer exists.')
    outcome = await pushToApp(session, app, image, syncDeps(did))
  } catch (err) {
    reportError('avatar push failed', err)
    return back(from, 'error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return finish(from, outcome)
}

/** The undo for one app. */
export async function restorePush(form: FormData): Promise<void> {
  const did = await signedIn()
  const from = fromForm(form)
  const app = appFrom(form)
  if (!app) return back(from, 'error', 'That app is not on the list.')
  let outcome: SyncOutcome
  try {
    outcome = await restorePrevious(await repoSession(did), app, syncDeps(did))
  } catch (err) {
    reportError('avatar restore failed', err)
    return back(from, 'error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return finish(from, outcome)
}

export async function dismissPushNotice(form: FormData): Promise<void> {
  const did = await signedIn()
  const app = appFrom(form)
  if (app) await getPushStore().dismissNotice(did, app.id)
  return redirect(PAGES[fromForm(form)])
}
