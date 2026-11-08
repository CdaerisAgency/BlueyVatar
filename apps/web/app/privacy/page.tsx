import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
export const metadata = pageMetadata('/privacy', 'Privacy | BlueyVatar', 'What BlueyVatar keeps about you on its own servers, including how we store email hashes.')

export default function PrivacyPage() {
  return (
    <PageMain>
      <h1>Privacy</h1>
      <p>BlueyVatar serves avatars and profiles that live in your own atproto repository. This page lists what we keep about you on our own servers.</p>
      <h2>Email addresses</h2>
      <p>When you link an email address, we store a SHA256 hash and an MD5 hash of it so that sites can look up your avatar by hash. The first address you link also stays on file, encrypted, so we can send you account notices. We never store a plain copy of an address, except that encrypted primary email. In your account, you see your primary email in full. Other linked emails show with the name part hidden, and the hash sits behind a Details link.</p>
      <p>We also store the domain of each linked email address (the part after the @, for example example.com) next to its hash, and never the full address in the clear. The domain lets us support domains that choose to serve their own avatars.</p>
      <p>Unlinking an address removes its hash and domain. Deleting your data removes all of them. After an address is unlinked or your data is deleted, we keep its hash for 30 days so no other account can claim it right away.</p>
      <h2>Download or delete your data</h2>
      <p>Signed in, open Your data in your account to download a JSON file of what we hold about you, or to delete it. Deleting removes your email hashes and domains, encrypted primary email, profile links, claims and attestations, visibility rules, license and API keys, custom domain, and indexed avatars and profile, and signs you out.</p>
      <h2>Billing records</h2>
      <p>If you paid for a plan, Stripe processes your payment and we keep a record of your Stripe customer and subscriptions. When you delete your data we keep these billing records for 7 years from the day you delete, because tax and accounting rules require it, and we use them for nothing else. We then delete them automatically. We cancel any active subscription when you delete your data.</p>
      <h2>Your repository</h2>
      <p>Your avatars, profile, and gallery stay in your atproto repository. We read them to deliver them. With your permission we also change the picture on your profile to match your default image, and we change nothing else in your repository except our own records. You can turn that off on the Avatars page, and each change is logged with your account identifier and the time. We keep a reference to your previous profile picture so you can restore it, which works only while your account's home server still stores that picture. Deleting your BlueyVatar data does not delete anything in your repository. Those records are yours and live on your account's home server (the service that stores your account and everything you post), so remove them there if you want them gone.</p>
      <p>Images you upload are re-encoded before they are stored in your repository, which removes location, camera, and other photo metadata (EXIF, XMP, and IPTC). We apply the photo orientation and keep the color profile and the full resolution.</p>
      <h2>Image screening</h2>
      <p>When you upload or import an image, we may send it to an automated screening service, which checks it against lists of known illegal images and does not keep it. We do not keep the image if the service flags it, and we do not write image content to our logs. When a match happens, we record the match, your account identifier, and the time. We also count matches and outages of the service per day. We store moderation labels from the labelers we follow, along with the account or record they apply to, and a label can create an item for our reviewers. These records are used for safety and abuse handling, and they are not shown on public pages.</p>
      <h2>Logs</h2>
      <p>Our servers keep request logs for security, abuse handling, and fixing faults. A log line holds the time, the route (not the full address), the response status, how long it took, and a request id. We do not log IP addresses, query strings, cookies, API keys, or email addresses in these logs.</p>
      <p>We keep logs for 90 days or until the logs reach a size cap, whichever comes first, and then delete them. Where we keep a hashed IP address in our database (for abuse reports and rate limits), it is removed on the same schedule.</p>
      <h2>Profile view counts</h2>
      <p>We count how many times your public profile page is viewed, and how many keyed API calls fetch your profile, as one number per day for each. We do not store the visitor's IP address, user agent, or any cookie with these counts, and we skip known crawlers. Plus members can see their last 30 days at Profile views in their account. The counts follow the same retention as logs: 90 days or until the logs reach a size cap, whichever comes first. They are included in your data download and removed when you delete your data.</p>
      <h2>Contact</h2>
      <p>For privacy or security questions, write to security@blueyvatar.com.</p>
    </PageMain>
  )
}
