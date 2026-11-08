import { redirect } from 'next/navigation'
import { PageMain } from '../../components/Page'
import { COPY } from '../../lib/copy'
import { currentDid } from '../../lib/auth'
import { safeNext } from '../../lib/next-path'
import { pageMetadata } from '../../lib/site'
import { LoginForm } from './LoginForm'

export const metadata = pageMetadata('/login', 'Sign in | blueyvatar', COPY.login.lead)

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (await currentDid()) redirect('/account')
  const { error, next } = await searchParams
  return (
    <PageMain narrow>
      <h1>{COPY.login.title}</h1>
      <p>{COPY.login.lead}</p>
      <LoginForm next={safeNext(next)} serverError={error} />
    </PageMain>
  )
}
