'use client'

import { useActionState } from 'react'
import type { VisibilityRules } from '../../../lib/visibility'
import { saveVisibility, type VisibilityState } from './actions'

export function VisibilityForm({ rules }: { rules: VisibilityRules }) {
  const [state, action, pending] = useActionState(saveVisibility, {} as VisibilityState)
  return (
    <form action={action}>
      <p>
        <label>
          <input type="checkbox" name="keyedOnly" defaultChecked={rules.keyedOnly} /> Keyed only: only requests with a valid license key can fetch my avatar and profile.
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" name="domainAllowlistOn" defaultChecked={rules.domainAllowlist.length > 0} /> Domain allowlist: only requests from the sites below can fetch.
        </label>
        <br />
        <textarea name="domains" rows={4} cols={40} defaultValue={rules.domainAllowlist.join('\n')} aria-label="Allowed domains" placeholder={'app.example.com\n*.example.com\nlocalhost'} />
        <br />
        One per line: exact host, *.example.com wildcard, or localhost.
      </p>
      <p>
        <label>
          <input type="checkbox" name="hiddenProfile" defaultChecked={rules.hiddenProfile} /> Hidden profile: my profile page and JSON return 404. My avatar is still served by hash or handle.
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" name="emailLookupOptOut" defaultChecked={rules.emailLookupOptOut} /> Opt out of email lookup: people cannot find my avatar by email hash.
        </label>
      </p>
      <button type="submit" className="bv-primary" disabled={pending}>Save</button>
      {state.error && <p role="alert">{state.error}</p>}
      {state.saved && <p role="status">Saved. Changes apply on the next request.</p>}
    </form>
  )
}
