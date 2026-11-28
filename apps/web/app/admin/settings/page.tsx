import { SETTING_DEFS, parseSettings, type ProfileAccess, type SettingKey, type SiteSettings } from '@blueyvatar/core/settings'
import { Button } from '../../../components/Button'
import { requireAdmin } from '../../../lib/admin/guard'
import { crossPlanWarnings } from '../../../lib/admin/settings-form'
import { getAssetMeta, listSettingRows, OVER_LIMIT_ASSET } from '../../../lib/admin/site-settings'
import { ADMIN_SETTINGS_COPY as COPY } from '../../../lib/copy/admin'
import { AdminPage, fmt } from '../AdminBits'
import { removeOverLimitAction, resetSettingAction, uploadOverLimitAction } from './actions'
import { SettingsForm } from './SettingsForm'

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

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { did, pool } = await requireAdmin()
  const sp = await searchParams
  const [rows, asset] = await Promise.all([listSettingRows(pool), getAssetMeta(pool, OVER_LIMIT_ASSET)])
  const { settings } = parseSettings(rows)
  const warnings = crossPlanWarnings(settings)
  const stored = new Set(rows.map((r) => r.key))
  const access = settings.profileAccess
  const accessDef = SETTING_DEFS.find((d) => d.key === 'embeds.profileAccess')!
  const ints = SETTING_DEFS.filter((d) => d.kind === 'int').map((d) => ({
    key: d.key,
    label: d.label,
    value: n(current(settings, d.key) as number),
    canReset: stored.has(d.key),
    help: `Default ${n(d.default as number)}. Allowed: ${n(d.min!)} to ${n(d.max!)}.${d.note ? ` ${d.note}` : ''}`,
  }))
  const defaultWho = WHO.filter((w) => (accessDef.default as ProfileAccess)[w]).map((w) => COPY.profileAccess.who[w]).join(', ')
  return (
    <AdminPage did={did} title={COPY.title} msg={sp.msg}>
      <p>{COPY.intro}</p>
      {warnings.length > 0 && (
        <section aria-label="Warnings">
          <h2>Check these</h2>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}
      <form id="reset-form" action={resetSettingAction} />
      <SettingsForm
        ints={ints}
        access={WHO.map((w) => ({ who: w, checked: access[w] }))}
        accessHelp={`Default: ${defaultWho}.`}
        accessCanReset={stored.has('embeds.profileAccess')}
      />
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
