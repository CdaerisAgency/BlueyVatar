'use client'

import { useActionState } from 'react'
import { Button } from '../../../components/Button'
import type { SaveState } from '../../../lib/admin/settings-form'
import { ADMIN_SETTINGS_COPY as COPY } from '../../../lib/copy/admin'
import { saveSettingsAction } from './actions'

export type IntField = { key: string; label: string; value: string; help: string; canReset: boolean }
export type AccessField = { who: 'anonymous' | 'free' | 'plus' | 'business'; checked: boolean }

const RESET_FORM = 'reset-form'
const resetClass = 'min-h-11 cursor-pointer disabled:cursor-not-allowed'

/**
 * The one settings form. Save is the only submit button that belongs to it, so Enter in a number field saves. The Reset buttons
 * belong to the separate form with id "reset-form" (rendered by the page) through their form attribute.
 * A failed save returns the typed values, which become the defaults again, so nothing typed is lost.
 */
export function SettingsForm({ ints, access, accessHelp, accessCanReset }: { ints: IntField[]; access: AccessField[]; accessHelp: string; accessCanReset: boolean }) {
  const [state, action] = useActionState<SaveState, FormData>(saveSettingsAction, null)
  const errors = state?.errors ?? {}
  const typed = (name: string, fallback: string) => state?.values[name] ?? fallback
  return (
    <form action={action}>
      {state && Object.keys(errors).length > 0 && <p role="alert">{COPY.msg.notSaved}</p>}
      {ints.map((f) => {
        const id = `s-${f.key}`
        const err = errors[f.key]
        return (
          <div key={f.key} className="mb-4">
            <label htmlFor={id}>{f.label}</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={id} name={f.key} type="text" inputMode="numeric" autoComplete="off" required className="min-h-11"
                defaultValue={typed(f.key, f.value)} aria-invalid={err ? true : undefined} aria-describedby={`${id}-help`}
              />
              <button type="submit" form={RESET_FORM} name="key" value={f.key} disabled={!f.canReset} className={resetClass}>Reset to default</button>
            </div>
            <p id={`${id}-help`}>{f.help}</p>
            {err && <p role="alert">{err}</p>}
          </div>
        )
      })}
      <fieldset>
        <legend>{COPY.profileAccess.legend}</legend>
        {access.map((a) => {
          const name = `embeds.profileAccess.${a.who}`
          return (
            <label key={a.who} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name={name} defaultChecked={state ? state.values[name] === 'on' : a.checked} />
              {COPY.profileAccess.who[a.who]}
            </label>
          )
        })}
        <p>{accessHelp}</p>
        {errors['embeds.profileAccess'] && <p role="alert">{errors['embeds.profileAccess']}</p>}
        <button type="submit" form={RESET_FORM} name="key" value="embeds.profileAccess" disabled={!accessCanReset} className={resetClass}>Reset to default</button>
      </fieldset>
      <Button type="submit" variant="primary" className="min-h-11">Save settings</Button>
    </form>
  )
}
