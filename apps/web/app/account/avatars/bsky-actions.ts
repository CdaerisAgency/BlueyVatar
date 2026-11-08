'use server'

import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { getSyncStore } from '../../../lib/bsky-sync-store'
import { restorePreviousBlueskyAvatar, useAsBlueskyAvatar, type SyncOutcome } from '../../../lib/bsky-sync'
import { syncDeps } from '../../../lib/bsky-sync-server'
import { reportError } from '../../../lib/obs'
import { RepoError, listImages, repoSession } from '../../../lib/repo'

const back = (key: 'error' | 'done', value: string): never => redirect(`/account/avatars?${key}=${encodeURIComponent(value)}`)
const finish = (o: SyncOutcome): never => back(o.ok ? 'done' : 'error', o.message)

async function signedIn(): Promise<string> {
  return (await currentDid()) ?? redirect('/login')
}

/** The "Use as my avatar" button on one image. */
export async function useAsBskyAvatar(form: FormData): Promise<void> {
  const did = await signedIn()
  let outcome: SyncOutcome
  try {
    const session = await repoSession(did)
    const image = (await listImages(session)).find((i) => i.rkey === String(form.get('rkey') ?? ''))
    if (!image) return back('error', 'That image no longer exists.')
    outcome = await useAsBlueskyAvatar(session, image, syncDeps(did))
  } catch (err) {
    reportError('bluesky avatar change failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return finish(outcome)
}

/** The "Restore my previous avatar" undo. */
export async function restoreBskyAvatar(): Promise<void> {
  const did = await signedIn()
  let outcome: SyncOutcome
  try {
    outcome = await restorePreviousBlueskyAvatar(await repoSession(did), syncDeps(did))
  } catch (err) {
    reportError('bluesky avatar restore failed', err)
    return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
  }
  return finish(outcome)
}

/** The switch "Keep my avatar the same as my default image". An unchecked box is off. */
export async function saveBskyAutoSync(form: FormData): Promise<void> {
  const did = await signedIn()
  const on = form.get('autoSync') === 'on'
  await getSyncStore().setAutoSync(did, on)
  return back('done', on ? 'Your profile avatar will follow your default image.' : 'Your profile avatar will stay as it is when you change your default image.')
}

export async function dismissBskyNotice(): Promise<void> {
  await getSyncStore().dismissNotice(await signedIn())
  return redirect('/account/avatars')
}
