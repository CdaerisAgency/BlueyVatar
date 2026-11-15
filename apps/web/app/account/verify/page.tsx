import { PageHeader, PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { fieldProps } from '../../../lib/field-props'
import { redirect } from 'next/navigation'
import { verifyCode } from '../../actions'
import { requireDid } from '../../../lib/auth'
import { getStore } from '../../../lib/store'


export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/verify')
  const pending = await getStore().codes.get(did)
  if (!pending) redirect('/account')
  const { error } = await searchParams
  return (
    <PageMain>
      <PageHeader title="Verify" intro={`We sent a 6-digit code to ${pending.masked}. It expires in 15 minutes.`} />
      {error && <p role="alert" id="verify-error">{error}</p>}
      <form action={verifyCode}>
        <Field prefix="verify" name="code" label="6-digit code" required>
          <input {...fieldProps('verify', 'code', undefined, error ? 'verify-error' : undefined)} aria-invalid={error ? true : undefined} name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" />
        </Field>
        <Button type="submit" variant="primary">Verify</Button>
      </form>
    </PageMain>
  )
}
