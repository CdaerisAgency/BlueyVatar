import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { redirect } from 'next/navigation'
import { verifyCode } from '../../actions'
import { requireDid } from '../../../lib/auth'
import { getStore } from '../../../lib/store'

export const dynamic = 'force-dynamic'

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await requireDid('/account/verify')
  const pending = await getStore().codes.get(did)
  if (!pending) redirect('/account')
  const { error } = await searchParams
  return (
    <PageMain narrow>
      <h1>Enter your code</h1>
      <p>We sent a 6-digit code to {pending.masked}. It expires in 15 minutes.</p>
      {error && <p role="alert">{error}</p>}
      <form action={verifyCode}>
        <label>
          6-digit code <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" />
        </label>
        <Button type="submit" variant="primary">Verify</Button>
      </form>
    </PageMain>
  )
}
