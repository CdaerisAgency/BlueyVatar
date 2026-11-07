import { login } from '../actions'
import { Button } from '../../components/Button'
import { PageMain } from '../../components/Page'
import { COPY } from '../../lib/copy'
import { pageMetadata } from '../../lib/site'

export const metadata = pageMetadata('/login', 'Sign in | blueyvatar', COPY.login.lead)

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <PageMain narrow>
      <h1>{COPY.login.title}</h1>
      <p>{COPY.login.lead}</p>
      {error && <p role="alert" id="login-error">{error}</p>}
      <form action={login}>
        <label>
          {COPY.login.label} <input name="handle" aria-invalid={error ? true : undefined} aria-describedby={error ? 'login-error' : undefined} placeholder={COPY.login.placeholder} required autoComplete="username" />
        </label>
        <Button type="submit" variant="primary">
          {COPY.login.submit}
        </Button>
      </form>
    </PageMain>
  )
}
