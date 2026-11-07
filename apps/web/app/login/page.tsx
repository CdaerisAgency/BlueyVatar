import { login } from '../actions'
import { Button } from '../../components/Button'
import { PageMain } from '../../components/Page'
import { COPY } from '../../lib/copy'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <PageMain narrow>
      <h1>{COPY.login.title}</h1>
      <p>{COPY.login.lead}</p>
      {error && <p role="alert">{error}</p>}
      <form action={login}>
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
