import { login } from '../actions'
import { Button } from '../../components/Button'
import { PageMain } from '../../components/Page'
import { COPY } from '../../lib/copy'
import { safeNext } from '../../lib/next-path'
import { pageMetadata } from '../../lib/site'

export const metadata = pageMetadata('/login', 'Sign in | blueyvatar', COPY.login.lead)

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams
  return (
    <PageMain narrow>
      <h1>{COPY.login.title}</h1>
      <p>{COPY.login.lead}</p>
      {error && <p role="alert">{error}</p>}
      <form action={login}>
        <input type="hidden" name="next" value={safeNext(next)} />
        <label>
          {COPY.login.label} <input name="handle" placeholder={COPY.login.placeholder} required autoComplete="username" />
        </label>
        <Button type="submit" variant="primary">
          {COPY.login.submit}
        </Button>
      </form>
    </PageMain>
  )
}
