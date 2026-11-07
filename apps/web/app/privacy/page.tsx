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
      <p>Unlinking an address removes its hash and domain. Deleting your data removes all of them. After an address is unlinked or your data is deleted, we keep its hash for 30 days so no other account can claim it right away.</p>
      <h2>Download or delete your data</h2>
      <p>Signed in, open Your data in your account to download a JSON file of what we hold about you, or to delete it. Deleting removes your email hashes and domains, encrypted primary email, profile links, claims and attestations, visibility rules, license and API keys, custom domain, and indexed avatars and profile, and signs you out.</p>
      <h2>Billing records</h2>
      <p>If you paid for a plan, Stripe processes your payment and we keep a record of your Stripe customer and subscriptions. When you delete your data we keep these billing records for 7 years from the day you delete, because tax and accounting rules require it, and we use them for nothing else. We then delete them automatically. We cancel any active subscription when you delete your data.</p>
      <h2>Your repository</h2>
      <p>Your avatars, profile, and gallery stay in your atproto repository. We read them to deliver them, and we cannot edit your repository. Deleting your blueyvatar data does not delete anything in your repository. Those records are yours and live on your PDS, so remove them there if you want them gone.</p>
      <h2>Logs</h2>
      <p>Our servers keep request logs for security, abuse handling, and fixing faults. A log line holds the time, the route (not the full address), the response status, how long it took, and a request id. We do not log IP addresses, query strings, cookies, API keys, or email addresses in these logs.</p>
      <p>We keep logs for 90 days or until the logs reach a size cap, whichever comes first, and then delete them. Where we keep a hashed IP address in our database (for abuse reports and rate limits), it is removed on the same schedule.</p>
      <h2>Contact</h2>
      <p>For privacy or security questions, write to security@blueyvatar.com.</p>
    </PageMain>
  )
}
