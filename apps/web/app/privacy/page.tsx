import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
export const metadata = pageMetadata('/privacy', 'Privacy | blueyvatar', 'What blueyvatar keeps about you on its own servers, including how we store email hashes.')

export default function PrivacyPage() {
  return (
    <PageMain>
      <h1>Privacy</h1>
      <p>blueyvatar serves avatars and profiles that live in your own atproto repository. This page lists what we keep about you on our own servers.</p>
      <h2>Email addresses</h2>
      <p>When you link an email address, we store a SHA256 hash and an MD5 hash of it so that sites can look up your avatar by hash. The first address you link also stays on file, encrypted, so we can send you account notices. We never store a plain copy of an address.</p>
      <p>We also store the domain of each linked email address (the part after the @, for example example.com) next to its hash, and never the full address in the clear. The domain lets us support domains that choose to serve their own avatars.</p>
      <p>Unlinking an address removes its hash and domain. Deleting your account removes all of them.</p>
      <h2>Your repository</h2>
      <p>Your avatars, profile, and gallery stay in your atproto repository. We read them to deliver them, and we cannot edit your repository.</p>
      <h2>Logs</h2>
      <p>Our servers keep request logs for security, abuse handling, and fixing faults. A log line holds the time, the route (not the full address), the response status, how long it took, and a request id. We do not log IP addresses, query strings, cookies, API keys, or email addresses in these logs.</p>
      <p>We keep logs for 90 days or until the logs reach a size cap, whichever comes first, and then delete them. Where we keep a hashed IP address in our database (for abuse reports and rate limits), it is removed on the same schedule.</p>
      <h2>Contact</h2>
      <p>For privacy or security questions, write to security@blueyvatar.com.</p>
    </PageMain>
  )
}
