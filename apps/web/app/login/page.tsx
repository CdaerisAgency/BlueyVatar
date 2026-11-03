import { login } from '../actions'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main>
      <h1>Sign in</h1>
      {error && <p role="alert">{error}</p>}
      <form action={login}>
        <label>
          Your atproto handle <input name="handle" placeholder="alice.bsky.social" required autoComplete="username" />
        </label>{' '}
        <button type="submit">Continue</button>
      </form>
    </main>
  )
}
