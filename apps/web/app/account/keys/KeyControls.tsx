'use client'
import { Button } from '../../../components/Button'

import { useActionState } from 'react'
import { createKey, revokeKey, rotateKey, saveAttributionSite, saveDomains, type KeyState } from './actions'
import { COPY } from '../../../lib/copy'

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
        <Button type="submit" variant="primary" disabled={pending || !!disabledReason}>
          Create key
        </Button>
      </form>
      <Result s={state} />
    </section>
  )
}

export function KeyActions({ hash, kind, domains, domainsEnabled, attribution }: { hash: string; kind: 'secret' | 'publishable'; domains: string[]; domainsEnabled: boolean; attribution?: { site: string | null } }) {
  const [rot, rotate, rotating] = useActionState(rotateKey, none)
  const [dom, saveDom, saving] = useActionState(saveDomains, none)
  const [att, saveAtt, savingAtt] = useActionState(saveAttributionSite, none)
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
            <Button type="submit" disabled={saving}>
              Save domains
            </Button>
            <Result s={dom} />
          </form>
        ) : (
          <p>Domain restrictions are not included in the Free tier.</p>
        ))}
      {kind === 'publishable' && attribution && (
        <form action={saveAtt}>
          <input type="hidden" name="hash" value={hash} />
          <label>
            {COPY.attribution.siteLabel}
            <br />
            <input name="site" type="url" inputMode="url" size={40} maxLength={300} placeholder={COPY.attribution.sitePlaceholder} defaultValue={attribution.site ?? ''} />
          </label>
          <br />
          <Button type="submit" disabled={savingAtt}>
            {COPY.attribution.siteSave}
          </Button>
          <Result s={att} />
        </form>
      )}
      <form action={rotate} className="inline">
        <input type="hidden" name="hash" value={hash} />
        <Button type="submit" disabled={rotating}>
          Rotate
        </Button>
      </form>{' '}
      <form action={revokeKey} className="inline">
        <input type="hidden" name="hash" value={hash} />
        <Button type="submit">Revoke</Button>
      </form>
      <Result s={rot} />
    </div>
  )
}
