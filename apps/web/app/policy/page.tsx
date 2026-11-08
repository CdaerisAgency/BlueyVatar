import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
export const metadata = pageMetadata('/policy', 'Content policy | blueyvatar', 'What blueyvatar does not allow, how to report content, and what we can and cannot remove.')

export default function PolicyPage() {
  return (
    <PageMain>
      <h1>Content policy</h1>
      <p>blueyvatar serves avatars and profiles that live in your own atproto repository. We can stop serving an image or profile from our service. We never edit your repository ourselves. The only change we make outside our own records is the picture on your profile, and only when you allow it.</p>
      <h2>Not allowed</h2>
      <ul>
        <li>Illegal content, including child sexual abuse material</li>
        <li>Content that infringes copyright or trademarks</li>
        <li>Explicit sexual content rated G or PG</li>
        <li>Malware or links that deliver it</li>
        <li>Impersonation of a person or organization</li>
        <li>Threats, harassment, or sharing private information</li>
        <li>Spam, scams, and squatting on names or emails you do not use</li>
      </ul>
      <p>Nudity is allowed when the image is rated correctly. See the ratings in the product documentation.</p>
      <h2>Reporting</h2>
      <p>Use the report link on any profile or avatar page. Reporting requires signing in with your atproto account, which lets us limit abuse and follow up. We store the account you reported from and the email you give, and neither is shown publicly. If you cannot sign in, write to <a href="mailto:security@blueyvatar.com">security@blueyvatar.com</a> for legal or urgent notices. Do not send identity documents or images of them. We aim to review reports within a few days. A report may lead to the image being removed from delivery and caches.</p>
      <h2 id="screening">Image screening</h2>
      <p>When you upload or import an image, we may check it with an automated screening service that compares it against lists of known illegal images. The check happens before the image is saved to your repository. If the service flags an image, the upload is refused, the image is not kept by us, and we record that a match happened for your account and the time. We also follow labels that moderation services apply to accounts and images on the atproto network: an image or account carrying a removal label is not served, and labels for adult or graphic content can raise an image's rating. Labels create items for our reviewers. If you think a screening result or a label is wrong, use the appeal process below.</p>
      <h2>Usage limits</h2>
      <p>To keep the service available, some actions are limited. Examples: a few email codes per hour, a limited number of avatar imports, uploads, claim checks, and key changes per hour, and short lockouts after repeated failed sign-ins or wrong codes. If you hit a limit, the page tells you how long to wait. Each account also has caps on stored items, such as 3 avatar images on Free and 20 on Plus, up to 10 linked emails, and up to 10 profile links.</p>
      <h2 id="appeals">Appeals</h2>
      <p>Who can appeal: the owner of an account whose images were taken down, whose account was suspended, who received a warning, or whose image rating was changed. You need to sign in, so we know the appeal comes from the account owner.</p>
      <p>What can be appealed: takedowns, suspensions, warnings, and rating changes. Decisions on reports you filed cannot be appealed.</p>
      <p>How: when we take one of these actions, we email the primary address on your account a notice with a link to the appeal form. You can also open the form at <a href="/account/appeal">/account/appeal</a> while signed in. Tell us why you think the decision was a mistake, in up to 2000 characters.</p>
      <p>Response time: we aim to answer within 7 days. A reviewer other than the one who took the action decides the appeal.</p>
      <p>Outcome: we email the primary address on your account to say whether the decision was reversed or kept. We do not share internal notes. If a decision is reversed, your images are served again after caches refresh.</p>
      <p>Limit: each takedown or suspension can be appealed once.</p>
      <p>What we keep: your account identifier, your statement, and the decision. You can download an appeal with your data, and deleting your data deletes it.</p>
    </PageMain>
  )
}
