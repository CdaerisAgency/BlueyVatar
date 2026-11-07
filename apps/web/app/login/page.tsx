import { login } from '../actions'
import { COPY } from '../../lib/copy'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main className="bv-narrow">
      <h1>{COPY.login.title}</h1>
      <p>{COPY.login.lead}</p>
      {error && <p role="alert">{error}</p>}
      <form action={login}>
        <label>
          {COPY.login.label} <input name="handle" placeholder={COPY.login.placeholder} required autoComplete="username" />
        </label>
        <button type="submit" className="bv-primary">
          {COPY.login.submit}
        </button>
      </form>
    </main>
  )
}
