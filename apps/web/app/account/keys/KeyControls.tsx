'use client'
import { Button } from '../../../components/Button'

import { useActionState, useState } from 'react'
import { DEFAULT_EXPIRY, EXPIRY_CHOICES, EXPIRY_LABELS } from '../../../lib/key-expiry'
import CopyField from '../CopyField'
import { createKey, revokeKey, rotateKey, saveDomains, type KeyState } from './actions'

const none: KeyState = {}

function Result({ s }: { s: KeyState }) {
  const label = s.keyKind === 'secret' ? 'Server key' : 'Website key'
  return (
    <>
      {s.error && <p role="alert">{s.error}</p>}
      {s.message && <p role="status">{s.message}</p>}
      {s.key && (
        <div>
          <p>
            <strong>Copy this key now. It is shown once. We keep only a hash of it, so we cannot show it again.</strong> If you lose it, revoke it and create a new one.
          </p>
          <CopyField label={`${label} (new)`} value={s.key} />
          <p>{s.expiresAt ? `This key stops working on ${s.expiresAt.slice(0, 10)}.` : 'This key does not expire.'}</p>
        </div>
      )}
    </>
  )
}

export function CreateKeyForm({ allowSecret, allowPublishable, disabledReason, orgId = '' }: { allowSecret: boolean; allowPublishable: boolean; disabledReason: string | null; orgId?: string }) {
  const [state, action, pending] = useActionState(createKey, none)
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState<string>(DEFAULT_EXPIRY)
  const [kind, setKind] = useState(allowPublishable ? 'publishable' : 'secret')
  // A failed submit keeps what was typed (the form would otherwise reset).
  const [seen, setSeen] = useState(state)
  if (seen !== state) {
    setSeen(state)
    if (state.error && state.values) {
      setLabel(state.values.label)
      setExpires(state.values.expires)
      setKind(state.values.kind)
    }
    if (state.key) setLabel('')
  }
  return (
    <section>
      <h2>Create a key</h2>
      <p>Both key types are read only today. The API has no way to change data yet.</p>
      <ul>
        <li>
          <strong>Website key</strong> (starts with <code>pk_</code>): put it in a web page or app. It goes in the <code>token</code> parameter. Anyone who views the page can see it, so on paid plans you can limit it to your own domains.
        </li>
        <li>
          <strong>Server key</strong> (starts with <code>sk_</code>): keep it on your server and never put it in a web page. It goes in the <code>x-api-key</code> header and is the only key that can read your usage.
        </li>
      </ul>
      {disabledReason && <p>{disabledReason}</p>}
      <form action={action}>
        <input type="hidden" name="org" value={orgId} />
        <label>
          Type{' '}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {allowPublishable && <option value="publishable">Website key (read only, safe in a web page)</option>}
            {allowSecret && <option value="secret">Server key (read only, keep private)</option>}
          </select>
        </label>
        <label>
          Name <input name="label" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional, such as My site" />
        </label>
        <label>
          Expires{' '}
          <select name="expires" value={expires} onChange={(e) => setExpires(e.target.value)}>
            {EXPIRY_CHOICES.map((c) => (
              <option key={c} value={c}>
                {EXPIRY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" disabled={pending || !!disabledReason}>
          Create key
        </Button>
      </form>
      <Result s={state} />
    </section>
  )
}

export function KeyActions({ hash, kind, domains, domainsEnabled, orgId = '' }: { hash: string; kind: 'secret' | 'publishable'; domains: string[]; domainsEnabled: boolean; orgId?: string }) {
  const [rot, rotate, rotating] = useActionState(rotateKey, none)
  const [dom, saveDom, saving] = useActionState(saveDomains, none)
  return (
    <div>
      {kind === 'publishable' &&
        (domainsEnabled ? (
          <form action={saveDom}>
            <input type="hidden" name="hash" value={hash} />
            <input type="hidden" name="org" value={orgId} />
            <label>
              Allowed domains (one per line: app.example.com, *.example.com, localhost). Empty allows any host.
              <br />
              <textarea name="domains" rows={3} cols={40} defaultValue={domains.join('\n')} />
            </label>
            <br />
            <Button type="submit" disabled={saving}>
              Save domains
            </Button>
            <Result s={dom} />
          </form>
        ) : (
          <p>Domain restrictions are not included in the Free tier.</p>
        ))}
      <form action={rotate} className="inline">
        <input type="hidden" name="hash" value={hash} />
            <input type="hidden" name="org" value={orgId} />
        <Button type="submit" disabled={rotating}>
          Rotate
        </Button>
      </form>{' '}
      <form action={revokeKey} className="inline">
        <input type="hidden" name="hash" value={hash} />
            <input type="hidden" name="org" value={orgId} />
        <Button type="submit">Revoke</Button>
      </form>
      <Result s={rot} />
    </div>
  )
}
