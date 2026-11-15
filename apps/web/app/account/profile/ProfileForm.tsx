'use client'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { FormNotices, useFocusResult } from '../../../components/FormNotices'
import { COPY } from '../../../lib/copy'
import { TIMEZONE_ENTRIES, entryForZone, isListedZone, zoneLabel } from '../../../lib/timezones'
import {
  INTERESTS_BOX_MAX_LENGTH, MAX_INTERESTS, MAX_INTEREST_CHARS, interestStats, fieldId,
  MAX_LANGUAGES, MAX_LANGUAGE_TAG_LENGTH, MAX_SOCIAL_LINKS, MAX_SOCIAL_LABEL_GRAPHEMES, MAX_SOCIAL_URL_LENGTH,
  MAX_WALLETS, MAX_WALLET_CHAIN_GRAPHEMES, MAX_WALLET_ADDRESS_GRAPHEMES, MAX_WALLET_LABEL_GRAPHEMES,
  type LanguageRow, type ProfileErrorKey, type ProfileFormState, type ProfileTextField, type ProfileValues, type SocialLinkRow, type WalletRow,
} from '../../../lib/profile-limits'
import { saveProfile } from './actions'
import { RowList, withKeys, type Keyed } from './RowList'
import { TextInput } from './TextInput'

const NOT_SET = ''


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

  // When nothing is saved, preselect the list entry that matches this browser's clock.
  useEffect(() => {
    if (initial.timezone) return
    try {
      const entry = entryForZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      if (entry) setTimezone((cur) => cur || entry.id)
    } catch {
      // No detection available: the field stays on Not set.
    }
  }, [initial.timezone])

  // After a result comes back, keep the typed values. Focus moves to the first problem or the notices.
  useEffect(() => {
    if (!state.values) return
    setInterests(state.values.interests)
    setTimezone(state.values.timezone)
    setLanguages(withKeys(state.values.languages))
    setSocialLinks(withKeys(state.values.socialLinks))
    setWallets(withKeys(state.values.wallets))
    setUseDefault(state.values.clearBackgroundColor)
    if (state.values.backgroundColor) setColor(state.values.backgroundColor)
  }, [state])
  const notices = useMemo(() => ({ errors: state.errors, formError: state.formError, sessionExpired: state.sessionExpired, done: state.saved }), [state])
  const problemKeys = useMemo(() => Object.keys(state.errors ?? {}) as ProfileErrorKey[], [state.errors])
  useFocusResult(notices, 'profile', problemKeys, summary, fieldId)

  const stats = interestStats(interests)
  const interestProblems = [
    stats.overLimit ? `Over the limit of ${MAX_INTERESTS}.` : '',
    stats.tooLong.length ? `Too long (over ${MAX_INTEREST_CHARS} characters): ${stats.tooLong.map((t) => `"${t.slice(0, 20)}..."`).join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  const err = (f: ProfileErrorKey) => errors[f]
  const described = (f: ProfileErrorKey, extra?: string) => [err(f) && `${fieldId(f)}-error`, extra].filter(Boolean).join(' ') || undefined
  const text = (name: ProfileTextField, label: string, max: number) => (
    <label className="bv-setting">
      {label}
      <input id={`profile-${name}`} name={name} defaultValue={v[name]} key={`${name}-${state.values ? 'r' : 'i'}`} maxLength={max} aria-invalid={err(name) ? true : undefined} aria-describedby={described(name)} />
      {err(name) && <span id={`profile-${name}-error`} className="field-error">{err(name)}</span>}
    </label>
  )
  return (
    <form action={action}>
      <FormNotices prefix="profile" labels={problemKeys} state={notices} summary={summary} retry={{ again: 'save again', submit: 'press Save' }} idFor={fieldId} />
      {text('jobTitle', 'Job title', 1000)}
      {text('company', 'Company', 1000)}
      {text('location', 'Location', 1000)}
      {text('pronouns', 'Pronouns', 400)}
      {text('pronunciation', 'Name pronunciation', 1000)}
      <div className="bv-setting">
      <label>
        {COPY.timezone.label}
        <select id="profile-timezone" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-invalid={err('timezone') ? true : undefined} aria-describedby={described('timezone', 'profile-timezone-help')}>
          <option value={NOT_SET}>{COPY.timezone.notSet}</option>
          {/* A stored zone that is not in the short list stays selected under its own name. */}
          {timezone && !isListedZone(timezone) && <option value={timezone}>{timezone} ({COPY.timezone.savedSuffix})</option>}
          {TIMEZONE_ENTRIES.map((e) => (
            <option key={e.id} value={e.id}>{zoneLabel(e)}</option>
          ))}
        </select>
        {err('timezone') && <span id="profile-timezone-error" className="field-error">{err('timezone')}</span>}
      </label>
      <p id="profile-timezone-help">{COPY.timezone.help}</p>
      <div>
      <Button
        type="button"
        onClick={() => {
          const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
          const entry = entryForZone(zone)
          if (entry) setTimezone(entry.id)
          else if (zone) setTimezone(zone)
        }}
      >
        {COPY.timezone.useCurrent}
      </Button>
      </div>
      </div>
      <div className="bv-setting">
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
      </div>
      <RowList
        id="profile-languages" legend="Languages" noun="language" max={MAX_LANGUAGES} rows={languages} setRows={setLanguages} blank={{ tag: '', primary: false }} error={err('languages')}
        help={<>Up to {MAX_LANGUAGES} languages, in the order you want them shown. Use a language tag such as en, es, fr, or pt-BR. {languages.length} of {MAX_LANGUAGES} languages.</>}
        row={(row, i, update) => {
          const key: ProfileErrorKey = `languages.${i}.tag`
          return (
            <>
              <TextInput id={fieldId(key)} name={`languages.${i}.tag`} label="Language tag" value={row.tag} maxLength={MAX_LANGUAGE_TAG_LENGTH} onChange={(e) => update({ tag: e.target.value })} error={err(key)} />
              <label>
                <input
                  type="radio"
                  name="languagesPrimary"
                  value={String(i)}
                  checked={row.primary}
                  onChange={() => setLanguages(languages.map((r) => ({ ...r, primary: r.key === row.key })))}
                /> Primary language
              </label>
            </>
          )
        }}
      />
      <RowList
        id="profile-socialLinks" legend="Links" noun="link" max={MAX_SOCIAL_LINKS} rows={socialLinks} setRows={setSocialLinks} blank={{ label: '', url: '' }} error={err('socialLinks')}
        help={<>Up to {MAX_SOCIAL_LINKS} links to your other accounts and sites, shown in this order. Addresses must start with https://. These are self-declared and not verified. {socialLinks.length} of {MAX_SOCIAL_LINKS} links.</>}
        row={(row, i, update) => {
          const lk: ProfileErrorKey = `socialLinks.${i}.label`
          const uk: ProfileErrorKey = `socialLinks.${i}.url`
          return (
            <>
              <TextInput id={fieldId(lk)} name={`socialLinks.${i}.label`} label="Label (optional)" value={row.label} onChange={(e) => update({ label: e.target.value })} error={err(lk)} countMax={MAX_SOCIAL_LABEL_GRAPHEMES} />
              <TextInput id={fieldId(uk)} name={`socialLinks.${i}.url`} label="Address" type="url" inputMode="url" placeholder="https://" value={row.url} maxLength={MAX_SOCIAL_URL_LENGTH} onChange={(e) => update({ url: e.target.value })} error={err(uk)} />
            </>
          )
        }}
      />
      <RowList
        id="profile-wallets" legend="Wallets" noun="wallet" max={MAX_WALLETS} rows={wallets} setRows={setWallets} blank={{ chain: '', address: '', label: '', visible: false }} error={err('wallets')}
        help={<>Up to {MAX_WALLETS} wallet addresses. Each one stays hidden unless you check Show on my public profile. Anyone can type any address, so your page labels shown wallets as not verified. Double-check each address before you save. {wallets.length} of {MAX_WALLETS} wallets.</>}
        row={(row, i, update) => {
          const ck: ProfileErrorKey = `wallets.${i}.chain`
          const ak: ProfileErrorKey = `wallets.${i}.address`
          const lk: ProfileErrorKey = `wallets.${i}.label`
          return (
            <>
              <TextInput id={fieldId(ck)} name={`wallets.${i}.chain`} label="Chain" value={row.chain} placeholder="For example Bitcoin" onChange={(e) => update({ chain: e.target.value })} error={err(ck)} countMax={MAX_WALLET_CHAIN_GRAPHEMES} />
              <TextInput id={fieldId(ak)} name={`wallets.${i}.address`} label="Address" value={row.address} autoComplete="off" spellCheck={false} onChange={(e) => update({ address: e.target.value })} error={err(ak)} countMax={MAX_WALLET_ADDRESS_GRAPHEMES} />
              <TextInput id={fieldId(lk)} name={`wallets.${i}.label`} label="Label (optional)" value={row.label} onChange={(e) => update({ label: e.target.value })} error={err(lk)} countMax={MAX_WALLET_LABEL_GRAPHEMES} />
              <label>
                <input type="checkbox" name={`wallets.${i}.visible`} checked={row.visible} onChange={(e) => update({ visible: e.target.checked })} /> Show on my public profile
              </label>
            </>
          )
        }}
      />
      <div className="bv-setting">
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
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        Save profile
      </Button>
    </form>
  )
}
