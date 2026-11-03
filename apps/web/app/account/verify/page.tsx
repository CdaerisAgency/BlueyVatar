import { redirect } from 'next/navigation'
import { verifyCode } from '../../actions'
import { currentDid } from '../../../lib/auth'
import { getStore } from '../../../lib/store'

export const dynamic = 'force-dynamic'

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const pending = await getStore().codes.get(did)
  if (!pending) redirect('/account')
  const { error } = await searchParams
  return (
    <main>
      <h1>Enter your code</h1>
      <p>We sent a 6-digit code to {pending.masked}. It expires in 15 minutes.</p>
      {error && <p role="alert">{error}</p>}
      <form action={verifyCode}>
        <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" />{' '}
        <button type="submit">Verify</button>
      </form>
    </main>
  )
}
