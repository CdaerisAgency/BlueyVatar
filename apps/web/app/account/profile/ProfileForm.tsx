'use client'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import {
  INTERESTS_BOX_MAX_LENGTH, MAX_INTERESTS, MAX_INTEREST_CHARS, interestStats, countGraphemes, fieldId,
  MAX_LANGUAGES, MAX_LANGUAGE_TAG_LENGTH, MAX_SOCIAL_LINKS, MAX_SOCIAL_LABEL_GRAPHEMES, MAX_SOCIAL_URL_LENGTH,
  MAX_WALLETS, MAX_WALLET_CHAIN_GRAPHEMES, MAX_WALLET_ADDRESS_GRAPHEMES, MAX_WALLET_LABEL_GRAPHEMES,
  type LanguageRow, type ProfileErrorKey, type ProfileFormState, type ProfileTextField, type ProfileValues, type SocialLinkRow, type WalletRow,
} from '../../../lib/profile-limits'
import { saveProfile } from './actions'

const NOT_SET = ''

function offsetLabel(zone: string, now: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value ?? ''
    const o = part === 'GMT' ? '+00:00' : part.replace('GMT', '')
    return `${zone.replace(/_/g, ' ')} (UTC${o})`
  } catch {
    return zone
  }
}

function zoneGroups(saved: string): { region: string; zones: { value: string; label: string }[] }[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  let list: string[] = []
  try {
    list = intl.supportedValuesOf?.('timeZone') ?? []
  } catch {
    list = []
  }
  if (!list.includes('UTC')) list = [...list, 'UTC']
  const now = new Date()
  const groups = new Map<string, { value: string; label: string }[]>()
  for (const z of list) {
    const region = z.includes('/') ? z.split('/')[0]! : 'Other'
    groups.set(region, [...(groups.get(region) ?? []), { value: z, label: offsetLabel(z, now) }])
  }
  const out = [...groups].map(([region, zones]) => ({ region, zones }))
  // A saved value that is not in the list still shows as the selected option.
  if (saved && !list.includes(saved)) out.unshift({ region: 'Saved value', zones: [{ value: saved, label: saved }] })
  return out
}

/** Rows carry a stable key so removing one row does not shuffle what is typed in the others. */
type Keyed<T> = T & { key: number }
let nextKey = 1
const withKeys = <T,>(rows: T[]): Keyed<T>[] => rows.map((r) => ({ ...r, key: nextKey++ }))

function Counter({ value, max }: { value: string; max: number }) {
  const n = countGraphemes(value)
  return <span className={n > max ? 'field-error' : undefined}>{n} of {max} characters</span>
}

export function ProfileForm({ initial, hasColor }: { initial: ProfileValues; hasColor: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, {} as ProfileFormState)
  const v: ProfileValues = state.values ?? initial
  const errors = state.errors ?? {}
  const [interests, setInterests] = useState(v.interests)
  const [color, setColor] = useState(v.backgroundColor || '#ffffff')
  const [useDefault, setUseDefault] = useState(state.values ? v.clearBackgroundColor : !hasColor)
  const [timezone, setTimezone] = useState(v.timezone)
  const [languages, setLanguages] = useState<Keyed<LanguageRow>[]>(() => withKeys(v.languages))
  const [socialLinks, setSocialLinks] = useState<Keyed<SocialLinkRow>[]>(() => withKeys(v.socialLinks))
  const [wallets, setWallets] = useState<Keyed<WalletRow>[]>(() => withKeys(v.wallets))
  const summary = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => zoneGroups(initial.timezone), [initial.timezone])

  // After a result comes back, keep the typed values and move focus to the first problem.
  useEffect(() => {
    if (!state.values) return
    setInterests(state.values.interests)
    setTimezone(state.values.timezone)
    setLanguages(withKeys(state.values.languages))
    setSocialLinks(withKeys(state.values.socialLinks))
    setWallets(withKeys(state.values.wallets))
    setUseDefault(state.values.clearBackgroundColor)
    if (state.values.backgroundColor) setColor(state.values.backgroundColor)
    const first = (Object.keys(state.errors ?? {}) as ProfileErrorKey[])[0]
    if (first) document.getElementById(fieldId(first))?.focus()
    else summary.current?.focus()
  }, [state])

  const stats = interestStats(interests)
  const interestProblems = [
    stats.overLimit ? `Over the limit of ${MAX_INTERESTS}.` : '',
    stats.tooLong.length ? `Too long (over ${MAX_INTEREST_CHARS} characters): ${stats.tooLong.map((t) => `"${t.slice(0, 20)}..."`).join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  const err = (f: ProfileErrorKey) => errors[f]
  const described = (f: ProfileErrorKey, extra?: string) => [err(f) && `${fieldId(f)}-error`, extra].filter(Boolean).join(' ') || undefined
  const text = (name: ProfileTextField, label: string, max: number) => (
    <label>
      {label}
      <input id={`profile-${name}`} name={name} defaultValue={v[name]} key={`${name}-${state.values ? 'r' : 'i'}`} maxLength={max} aria-invalid={err(name) ? true : undefined} aria-describedby={described(name)} />
      {err(name) && <span id={`profile-${name}-error`} className="field-error">{err(name)}</span>}
    </label>
  )
  const problems = (Object.entries(errors) as [ProfileErrorKey, string][])
  return (
    <form action={action}>
      <div ref={summary} tabIndex={-1}>
        {problems.length > 0 && (
          <div role="alert">
            <p>Fix these and save again. Everything you typed is still here.</p>
            <ul>
              {problems.map(([f, m]) => (
                <li key={f}><a href={`#${fieldId(f)}`}>{m}</a></li>
              ))}
            </ul>
          </div>
        )}
        {state.formError && (
          <p role="alert">
            {state.formError}
            {state.sessionExpired && <> <a href="/login" target="_blank" rel="noreferrer">Sign in again</a> in a new tab, then press Save here.</>}
          </p>
        )}
        {state.saved && <p role="status">{state.saved}</p>}
      </div>
      {text('jobTitle', 'Job title', 1000)}
      {text('company', 'Company', 1000)}
      {text('location', 'Location', 1000)}
      {text('pronouns', 'Pronouns', 400)}
      {text('pronunciation', 'Name pronunciation', 1000)}
      <label>
        Time zone
        <select id="profile-timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-invalid={err('timezone') ? true : undefined} aria-describedby={described('timezone')} suppressHydrationWarning>
          <option value={NOT_SET}>Not set</option>
          {groups.map((g) => (
            <optgroup key={g.region} label={g.region}>
              {g.zones.map((z) => (
                <option key={z.value} value={z.value}>{z.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {err('timezone') && <span id="profile-timezone-error" className="field-error">{err('timezone')}</span>}
      </label>
      <button type="button" onClick={() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use my current time zone</button>
      <label>
        Interests
        <textarea
          id="profile-interests"
          name="interests"
          rows={3}
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          maxLength={INTERESTS_BOX_MAX_LENGTH}
          aria-invalid={err('interests') || interestProblems ? true : undefined}
          aria-describedby={described('interests', 'profile-interests-help')}
        />
        {err('interests') && <span id="profile-interests-error" className="field-error">{err('interests')}</span>}
      </label>
      <p id="profile-interests-help" aria-live="polite">
        Up to {MAX_INTERESTS} interests, {MAX_INTEREST_CHARS} characters each. Separate them with commas or new lines. {stats.count} of {MAX_INTERESTS} interests. {interestProblems}
      </p>
      <fieldset id="profile-languages" tabIndex={-1}>
        <legend>Languages</legend>
        <p id="profile-languages-help">
          Up to {MAX_LANGUAGES} languages, in the order you want them shown. Use a language tag such as en, es, fr, or pt-BR. {languages.length} of {MAX_LANGUAGES} languages.
        </p>
        {err('languages') && <p id="profile-languages-error" className="field-error">{err('languages')}</p>}
        {languages.map((row, i) => {
          const key: ProfileErrorKey = `languages.${i}.tag`
          return (
            <div key={row.key} role="group" aria-label={`Language ${i + 1}`}>
              <label>
                Language tag
                <input
                  id={fieldId(key)}
                  name={`languages.${i}.tag`}
                  value={row.tag}
                  maxLength={MAX_LANGUAGE_TAG_LENGTH}
                  onChange={(e) => setLanguages(languages.map((r) => (r.key === row.key ? { ...r, tag: e.target.value } : r)))}
                  aria-invalid={err(key) ? true : undefined}
                  aria-describedby={described(key)}
                />
                {err(key) && <span id={`${fieldId(key)}-error`} className="field-error">{err(key)}</span>}
              </label>
              <label>
                <input
                  type="radio"
                  name="languagesPrimary"
                  value={String(i)}
                  checked={row.primary}
                  onChange={() => setLanguages(languages.map((r) => ({ ...r, primary: r.key === row.key })))}
                /> Primary language
              </label>
              <button type="button" onClick={() => setLanguages(languages.filter((r) => r.key !== row.key))}>Remove language {i + 1}</button>
            </div>
          )
        })}
        <button type="button" disabled={languages.length >= MAX_LANGUAGES} onClick={() => setLanguages([...languages, ...withKeys([{ tag: '', primary: false }])])}>Add a language</button>
      </fieldset>
      <fieldset id="profile-socialLinks" tabIndex={-1}>
        <legend>Links</legend>
        <p id="profile-socialLinks-help">
          Up to {MAX_SOCIAL_LINKS} links to your other accounts and sites, shown in this order. Addresses must start with https://. These are self-declared and not verified. {socialLinks.length} of {MAX_SOCIAL_LINKS} links.
        </p>
        {err('socialLinks') && <p id="profile-socialLinks-error" className="field-error">{err('socialLinks')}</p>}
        {socialLinks.map((row, i) => {
          const lk: ProfileErrorKey = `socialLinks.${i}.label`
          const uk: ProfileErrorKey = `socialLinks.${i}.url`
          return (
            <div key={row.key} role="group" aria-label={`Link ${i + 1}`}>
              <label>
                Label (optional)
                <input
                  id={fieldId(lk)}
                  name={`socialLinks.${i}.label`}
                  value={row.label}
                  onChange={(e) => setSocialLinks(socialLinks.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r)))}
                  aria-invalid={err(lk) ? true : undefined}
                  aria-describedby={described(lk, `${fieldId(lk)}-count`)}
                />
                <span id={`${fieldId(lk)}-count`} aria-live="polite"><Counter value={row.label} max={MAX_SOCIAL_LABEL_GRAPHEMES} /></span>
                {err(lk) && <span id={`${fieldId(lk)}-error`} className="field-error">{err(lk)}</span>}
              </label>
              <label>
                Address
                <input
                  id={fieldId(uk)}
                  name={`socialLinks.${i}.url`}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={row.url}
                  maxLength={MAX_SOCIAL_URL_LENGTH}
                  onChange={(e) => setSocialLinks(socialLinks.map((r) => (r.key === row.key ? { ...r, url: e.target.value } : r)))}
                  aria-invalid={err(uk) ? true : undefined}
                  aria-describedby={described(uk)}
                />
                {err(uk) && <span id={`${fieldId(uk)}-error`} className="field-error">{err(uk)}</span>}
              </label>
              <button type="button" onClick={() => setSocialLinks(socialLinks.filter((r) => r.key !== row.key))}>Remove link {i + 1}</button>
            </div>
          )
        })}
        <button type="button" disabled={socialLinks.length >= MAX_SOCIAL_LINKS} onClick={() => setSocialLinks([...socialLinks, ...withKeys([{ label: '', url: '' }])])}>Add a link</button>
      </fieldset>
      <fieldset id="profile-wallets" tabIndex={-1}>
        <legend>Wallets</legend>
        <p id="profile-wallets-help">
          Up to {MAX_WALLETS} wallet addresses. Each one stays hidden unless you check Show on my public profile. Anyone can type any address, so your page labels shown wallets as not verified. Double-check each address before you save. {wallets.length} of {MAX_WALLETS} wallets.
        </p>
        {err('wallets') && <p id="profile-wallets-error" className="field-error">{err('wallets')}</p>}
        {wallets.map((row, i) => {
          const ck: ProfileErrorKey = `wallets.${i}.chain`
          const ak: ProfileErrorKey = `wallets.${i}.address`
          const lk: ProfileErrorKey = `wallets.${i}.label`
          const set = (patch: Partial<WalletRow>) => setWallets(wallets.map((r) => (r.key === row.key ? { ...r, ...patch } : r)))
          return (
            <div key={row.key} role="group" aria-label={`Wallet ${i + 1}`}>
              <label>
                Chain
                <input id={fieldId(ck)} name={`wallets.${i}.chain`} value={row.chain} placeholder="For example Bitcoin" onChange={(e) => set({ chain: e.target.value })} aria-invalid={err(ck) ? true : undefined} aria-describedby={described(ck, `${fieldId(ck)}-count`)} />
                <span id={`${fieldId(ck)}-count`} aria-live="polite"><Counter value={row.chain} max={MAX_WALLET_CHAIN_GRAPHEMES} /></span>
                {err(ck) && <span id={`${fieldId(ck)}-error`} className="field-error">{err(ck)}</span>}
              </label>
              <label>
                Address
                <input id={fieldId(ak)} name={`wallets.${i}.address`} value={row.address} autoComplete="off" spellCheck={false} onChange={(e) => set({ address: e.target.value })} aria-invalid={err(ak) ? true : undefined} aria-describedby={described(ak, `${fieldId(ak)}-count`)} />
                <span id={`${fieldId(ak)}-count`} aria-live="polite"><Counter value={row.address} max={MAX_WALLET_ADDRESS_GRAPHEMES} /></span>
                {err(ak) && <span id={`${fieldId(ak)}-error`} className="field-error">{err(ak)}</span>}
              </label>
              <label>
                Label (optional)
                <input id={fieldId(lk)} name={`wallets.${i}.label`} value={row.label} onChange={(e) => set({ label: e.target.value })} aria-invalid={err(lk) ? true : undefined} aria-describedby={described(lk, `${fieldId(lk)}-count`)} />
                <span id={`${fieldId(lk)}-count`} aria-live="polite"><Counter value={row.label} max={MAX_WALLET_LABEL_GRAPHEMES} /></span>
                {err(lk) && <span id={`${fieldId(lk)}-error`} className="field-error">{err(lk)}</span>}
              </label>
              <label>
                <input type="checkbox" name={`wallets.${i}.visible`} checked={row.visible} onChange={(e) => set({ visible: e.target.checked })} /> Show on my public profile
              </label>
              <button type="button" onClick={() => setWallets(wallets.filter((r) => r.key !== row.key))}>Remove wallet {i + 1}</button>
            </div>
          )
        })}
        <button type="button" disabled={wallets.length >= MAX_WALLETS} onClick={() => setWallets([...wallets, ...withKeys([{ chain: '', address: '', label: '', visible: false }])])}>Add a wallet</button>
      </fieldset>
      <label>
        Page background color
        <span className="color-row">
          <input
            id="profile-backgroundColor"
            type="color"
            name="backgroundColor"
            value={color}
            disabled={useDefault}
            onChange={(e) => {
              setColor(e.target.value)
              setUseDefault(false)
            }}
            aria-invalid={err('backgroundColor') ? true : undefined}
            aria-describedby={described('backgroundColor')}
          />
          <span>{useDefault ? 'Default colors' : color}</span>
        </span>
        {err('backgroundColor') && <span id="profile-backgroundColor-error" className="field-error">{err('backgroundColor')}</span>}
      </label>
      {useDefault && <input type="hidden" name="backgroundColor" value="" />}
      <label>
        <input type="checkbox" name="clearBackgroundColor" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} /> Use the default colors (clears the background color)
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        Save profile
      </Button>
    </form>
  )
}
