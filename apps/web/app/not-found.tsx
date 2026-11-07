import { ButtonLink } from '../components/Button'
import { PageMain } from '../components/Page'
import { COPY } from '../lib/copy'

export default function NotFound() {
  return (
    <PageMain narrow>
      <h1>{COPY.notFound.title}</h1>
      <p>{COPY.notFound.body}</p>
      <ButtonLink href="/" variant="primary">
        {COPY.notFound.home}
      </ButtonLink>
    </PageMain>
  )
}
