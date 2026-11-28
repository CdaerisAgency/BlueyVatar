'use server'

import { redirect } from 'next/navigation'
import { SETTING_DEFS, type SettingKey } from '@blueyvatar/core/settings'
import { requireAdmin } from '../../../lib/admin/guard'
import { overLimitPurgerFromEnv } from '../../../lib/admin/purge'
import { ASSET_MAX_BYTES, putOverLimitAsset, removeOverLimitAsset, resetSetting, saveSettings } from '../../../lib/admin/site-settings'
import { ADMIN_SETTINGS_COPY as COPY } from '../../../lib/copy/admin'
import { formChanges } from '../../../lib/admin/settings-form'
import { limited } from '../../../lib/rate-guard'

const PATH = '/admin/settings'
const to = (msg: string, errors?: Record<string, string>): never =>
  redirect(`${PATH}?msg=${encodeURIComponent(msg)}${errors ? `&err=${encodeURIComponent(JSON.stringify(errors))}` : ''}`)

/** Saves every number and the four access boxes in one go. If any value is invalid nothing is saved and the fields are marked. */
export async function saveSettingsAction(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(wait)
  const out = await saveSettings(a.pool, a.did, formChanges(form))
  if (!out.ok) return to(COPY.msg.notSaved, out.errors)
  return to(COPY.msg.saved(out.changed.length))
}

/** Deletes the stored value of one setting so the built-in default applies again. */
export async function resetSettingAction(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(wait)
  const key = String(form.get('key') ?? '')
  if (!SETTING_DEFS.some((d) => d.key === key)) return to(COPY.msg.unknownSetting)
  await resetSetting(a.pool, a.did, key as SettingKey)
  return to(COPY.msg.reset)
}

const purgeNote = async (): Promise<string> => ((await overLimitPurgerFromEnv()()) ? '' : COPY.msg.purgeMissing)

export async function uploadOverLimitAction(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(wait)
  const file = form.get('image')
  if (!(file instanceof File) || file.size === 0) return to(COPY.msg.noFile)
  if (file.size > ASSET_MAX_BYTES) return to('The image must be 2 MB or smaller.')
  const out = await putOverLimitAsset(a.pool, a.did, Buffer.from(await file.arrayBuffer()))
  if (!out.ok) return to(out.error)
  return to(COPY.msg.uploaded + (await purgeNote()))
}

export async function removeOverLimitAction(): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to(wait)
  await removeOverLimitAsset(a.pool, a.did)
  return to(COPY.msg.removed + (await purgeNote()))
}
