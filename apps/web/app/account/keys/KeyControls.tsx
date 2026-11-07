'use client'

import { useActionState } from 'react'
import { createKey, revokeKey, rotateKey, saveDomains, type KeyState } from './actions'

const none: KeyState = {}

function Result({ s }: { s: KeyState }) {
  return (
    <>
      {s.error && <p role="alert">{s.error}</p>}
      {s.message && <p role="status">{s.message}</p>}
      {s.key && (
        <div role="status">
          <p>
            <strong>Copy this {s.keyKind} key now. It is shown only once and cannot be recovered.</strong>
          </p>
          <pre tabIndex={0}>
            <code>{s.key}</code>
          </pre>
        </div>
      )}
    </>
  )
}

export function CreateKeyForm({ allowSecret, allowPublishable, disabledReason }: { allowSecret: boolean; allowPublishable: boolean; disabledReason: string | null }) {
  const [state, action, pending] = useActionState(createKey, none)
  return (
    <section>
      <h2>Create a key</h2>
      {disabledReason && <p>{disabledReason}</p>}
      <form action={action}>
        <label>
          Type{' '}
          <select name="kind" defaultValue={allowPublishable ? 'publishable' : 'secret'}>
            {allowPublishable && <option value="publishable">Publishable (pk_, browsers)</option>}
            {allowSecret && <option value="secret">Secret (sk_, servers)</option>}
          </select>
        </label>
        <label>
          Label <input name="label" maxLength={60} placeholder="optional" />
        </label>
        <button type="submit" className="bv-primary" disabled={pending || !!disabledReason}>
          Create key
        </button>
      </form>
      <Result s={state} />
    </section>
  )
}

export function KeyActions({ hash, kind, domains, domainsEnabled }: { hash: string; kind: 'secret' | 'publishable'; domains: string[]; domainsEnabled: boolean }) {
  const [rot, rotate, rotating] = useActionState(rotateKey, none)
  const [dom, saveDom, saving] = useActionState(saveDomains, none)
  return (
    <div>
      {kind === 'publishable' &&
        (domainsEnabled ? (
          <form action={saveDom}>
            <input type="hidden" name="hash" value={hash} />
            <label>
              Allowed domains (one per line: app.example.com, *.example.com, localhost). Empty allows any host.
              <br />
              <textarea name="domains" rows={3} cols={40} defaultValue={domains.join('\n')} />
            </label>
            <br />
            <button type="submit" disabled={saving}>
              Save domains
            </button>
            <Result s={dom} />
          </form>
        ) : (
          <p>Domain restrictions are not included in the Free tier.</p>
        ))}
      <form action={rotate} style={{ display: 'inline' }}>
        <input type="hidden" name="hash" value={hash} />
        <button type="submit" disabled={rotating}>
          Rotate
        </button>
      </form>{' '}
      <form action={revokeKey} style={{ display: 'inline' }}>
        <input type="hidden" name="hash" value={hash} />
        <button type="submit">Revoke</button>
      </form>
      <Result s={rot} />
    </div>
  )
}
