import { redirect } from 'next/navigation'
import { currentDid } from './auth'
import { limited } from './rate-guard'
import { reportError } from './obs'
import { RepoError } from './repo'
import type { Result } from './effects/flow'

type Buckets = Parameters<typeof limited>[0]

/**
 * Builds the `run` helper of a server-action file whose actions end in a redirect to `path` with `?error=` or `?done=`.
 * The session check stays here, so every action built on it still sends signed-out visitors to /login.
 * `suffix` is appended to the redirect query; `limit` names rate buckets to check before `go` runs.
 */
export function actionRunner(path: string, errorLabel: string) {
  return async function run(go: (did: string) => Promise<Result>, opts: { limit?: Buckets; suffix?: string } = {}): Promise<never> {
    const back = (key: 'error' | 'done', value: string): never => redirect(`${path}?${key}=${encodeURIComponent(value)}${opts.suffix ?? ''}`)
    const did = (await currentDid()) ?? redirect('/login')
    if (opts.limit) {
      const wait = await limited(opts.limit, did)
      if (wait) return back('error', wait)
    }
    let r: Result
    try {
      r = await go(did)
    } catch (err) {
      reportError(errorLabel, err)
      return back('error', err instanceof RepoError ? err.message : 'Something went wrong. Try again.')
    }
    return r.ok ? back('done', r.message) : back('error', r.error)
  }
}
