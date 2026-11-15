import Link from 'next/link'
import { Button } from '../../components/Button'
import { Section } from '../../components/Page'

/** Where to download or delete data, and the sign-out button. */
export function DataSection() {
  return (
    <Section title="Your data">
    <p>
      Go to <Link href="/account/settings/danger">Danger zone</Link> to download your data or delete it. Deleting removes what BlueyVatar holds about you, except
      billing records, which we keep for 7 years. Records in your own atproto repository stay on your Bluesky account's home server. The home server is the service that stores your Bluesky account and everything you post.
    </p>
    <form action="/logout" method="post">
      <Button type="submit">Sign out</Button>
    </form>
    </Section>
  )
}
