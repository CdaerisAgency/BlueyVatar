'use client'
import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../components/Button'
import { INTERESTS_BOX_MAX_LENGTH, MAX_INTERESTS, MAX_INTEREST_CHARS, interestStats, type ProfileField, type ProfileFormState, type ProfileValues } from '../../../lib/profile-limits'
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

export function ProfileForm({ initial, hasColor }: { initial: ProfileValues; hasColor: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, {} as ProfileFormState)
  const v: ProfileValues = state.values ?? initial
  const errors = state.errors ?? {}
  const [interests, setInterests] = useState(v.interests)
  const [color, setColor] = useState(v.backgroundColor || '#ffffff')
  const [useDefault, setUseDefault] = useState(state.values ? v.clearBackgroundColor : !hasColor)
  const [timezone, setTimezone] = useState(v.timezone)
  const summary = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => zoneGroups(initial.timezone), [initial.timezone])

  // After a result comes back, keep the typed values and move focus to the first problem.
  useEffect(() => {
    if (!state.values) return
    setInterests(state.values.interests)
    setTimezone(state.values.timezone)
    setUseDefault(state.values.clearBackgroundColor)
    if (state.values.backgroundColor) setColor(state.values.backgroundColor)
    const first = (Object.keys(state.errors ?? {}) as ProfileField[])[0]
    if (first) document.getElementById(`profile-${first}`)?.focus()
    else summary.current?.focus()
  }, [state])

  const stats = interestStats(interests)
  const interestProblems = [
    stats.overLimit ? `Over the limit of ${MAX_INTERESTS}.` : '',
    stats.tooLong.length ? `Too long (over ${MAX_INTEREST_CHARS} characters): ${stats.tooLong.map((t) => `"${t.slice(0, 20)}..."`).join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  const err = (f: ProfileField) => errors[f]
  const described = (f: ProfileField, extra?: string) => [err(f) && `profile-${f}-error`, extra].filter(Boolean).join(' ') || undefined
  const text = (name: ProfileField, label: string, max: number) => (
    <label>
      {label}
      <input id={`profile-${name}`} name={name} defaultValue={v[name]} key={`${name}-${state.values ? 'r' : 'i'}`} maxLength={max} aria-invalid={err(name) ? true : undefined} aria-describedby={described(name)} />
      {err(name) && <span id={`profile-${name}-error`} className="field-error">{err(name)}</span>}
    </label>
  )
  const problems = (Object.entries(errors) as [ProfileField, string][])
  return (
    <form action={action}>
      <div ref={summary} tabIndex={-1}>
        {problems.length > 0 && (
          <div role="alert">
            <p>Fix these and save again. Everything you typed is still here.</p>
            <ul>
              {problems.map(([f, m]) => (
                <li key={f}><a href={`#profile-${f}`}>{m}</a></li>
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
