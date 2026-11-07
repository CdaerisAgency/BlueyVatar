import { PageMain } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { requireAdminDid } from '../../../lib/admin/guard'
import { adminLogin } from '../actions'

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdminDid()
  const { error } = await searchParams
  return (
    <PageMain narrow>
      <h1>Admin sign-in</h1>
      <p>You are signed in with an admin account. Enter the six-digit code from your authenticator app. The admin session ends after 30 minutes.</p>
      {error && <p role="alert">{error}</p>}
      <form action={adminLogin}>
        <label>Code <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required /></label>
        <Button type="submit" variant="primary">Continue</Button>
      </form>
    </PageMain>
  )
}
