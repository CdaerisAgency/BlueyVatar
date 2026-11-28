import { SETTING_DEFS, parseSettings, type ProfileAccess, type SettingKey, type SiteSettings } from '@blueyvatar/core/settings'
import { Button } from '../../../components/Button'
import { requireAdmin } from '../../../lib/admin/guard'
import { crossPlanWarnings } from '../../../lib/admin/settings-form'
import { getAssetMeta, listSettingRows, OVER_LIMIT_ASSET } from '../../../lib/admin/site-settings'
import { ADMIN_SETTINGS_COPY as COPY } from '../../../lib/copy/admin'
import { AdminPage, fmt } from '../AdminBits'
import { removeOverLimitAction, resetSettingAction, saveSettingsAction, uploadOverLimitAction } from './actions'

export const metadata = { title: COPY.title }

const WHO = ['anonymous', 'free', 'plus', 'business'] as const
const n = (v: number) => v.toLocaleString('en-US')

function current(s: SiteSettings, key: SettingKey): number | ProfileAccess {
  switch (key) {
    case 'limits.anonymousDaily': return s.anonymousDaily
    case 'limits.free.keyedDaily': return s.keyedDaily.free
    case 'limits.plus.keyedMonthly': return s.keyedMonthly.plus
    case 'limits.business.keyedMonthly': return s.keyedMonthly.business
    case 'sizes.free.maxSize': return s.maxSize.free
    case 'sizes.plus.maxSize': return s.maxSize.plus
    case 'sizes.business.maxSize': return s.maxSize.business
    case 'embeds.profileAccess': return s.profileAccess
  }
}

function parseErrors(raw?: string): Record<string, string> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, m]) => typeof m === 'string')) as Record<string, string>
  } catch {
    return {}
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const { did, pool } = await requireAdmin()
  const sp = await searchParams
  const errors = parseErrors(sp.err)
  const [rows, asset] = await Promise.all([listSettingRows(pool), getAssetMeta(pool, OVER_LIMIT_ASSET)])
  const { settings } = parseSettings(rows)
  const warnings = crossPlanWarnings(settings)
  const stored = new Set(rows.map((r) => r.key))
  const access = settings.profileAccess
  const accessDef = SETTING_DEFS.find((d) => d.key === 'embeds.profileAccess')!
  return (
    <AdminPage did={did} title={COPY.title} msg={sp.msg}>
      <p>{COPY.intro}</p>
      {warnings.length > 0 && (
        <section aria-label="Warnings">
          <h2>Check these</h2>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}
      <form action={saveSettingsAction}>
        {SETTING_DEFS.filter((d) => d.kind === 'int').map((d) => {
          const id = `s-${d.key}`
          const err = errors[d.key]
          return (
            <div key={d.key} className="mb-4">
              <label htmlFor={id}>{d.label}</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={id} name={d.key} type="text" inputMode="numeric" autoComplete="off" required className="min-h-11"
                  defaultValue={n(current(settings, d.key) as number)}
                  aria-invalid={err ? true : undefined} aria-describedby={`${id}-help`}
                />
                <button type="submit" formAction={resetSettingAction} name="key" value={d.key} formNoValidate disabled={!stored.has(d.key)} className="min-h-11 cursor-pointer disabled:cursor-not-allowed">
                  Reset to default
                </button>
              </div>
              <p id={`${id}-help`}>
                Default {n(d.default as number)}. Allowed: {n(d.min!)} to {n(d.max!)}.{d.note ? ` ${d.note}` : ''}
              </p>
              {err && <p role="alert">{err}</p>}
            </div>
          )
        })}
        <fieldset>
          <legend>{COPY.profileAccess.legend}</legend>
          {WHO.map((w) => (
            <label key={w} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name={`embeds.profileAccess.${w}`} defaultChecked={access[w]} />
              {COPY.profileAccess.who[w]}
            </label>
          ))}
          <p>Default: {WHO.filter((w) => (accessDef.default as ProfileAccess)[w]).map((w) => COPY.profileAccess.who[w]).join(', ')}.</p>
          {errors['embeds.profileAccess'] && <p role="alert">{errors['embeds.profileAccess']}</p>}
          <button type="submit" formAction={resetSettingAction} name="key" value="embeds.profileAccess" formNoValidate disabled={!stored.has('embeds.profileAccess')} className="min-h-11 cursor-pointer disabled:cursor-not-allowed">
            Reset to default
          </button>
        </fieldset>
        <Button type="submit" variant="primary" className="min-h-11">Save settings</Button>
      </form>
      <section aria-label={COPY.overLimit.title}>
        <h2>{COPY.overLimit.title}</h2>
        <p>{COPY.overLimit.intro}</p>
        {asset ? (
          <figure>
            <img src={`/admin/settings/over-limit?v=${asset.sha256.slice(0, 12)}`} alt="The current over-limit avatar" width={128} height={128} />
            <figcaption>{asset.width} by {asset.height} px, uploaded {fmt(asset.updatedAt)}</figcaption>
          </figure>
        ) : <p>{COPY.overLimit.none}</p>}
        <form action={uploadOverLimitAction} encType="multipart/form-data">
          <label>Image <input type="file" name="image" accept="image/png,image/jpeg,image/webp" required className="min-h-11" /></label>
          <Button type="submit" variant="primary" className="min-h-11">Upload</Button>
        </form>
        {asset && <form action={removeOverLimitAction}><Button type="submit" variant="danger" className="min-h-11">Remove</Button></form>}
      </section>
      <p>{COPY.footer}</p>
    </AdminPage>
  )
}
