import { PageMain } from '../../components/Page'
export const metadata = { title: 'Content policy' }

export default function PolicyPage() {
  return (
    <PageMain>
      <h1>Content policy</h1>
      <p>blueyvatar serves avatars and profiles that live in your own atproto repository. We can stop serving an image or profile from our service. We cannot edit your repository.</p>
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
      <p>Use the report link on any profile or avatar page. You do not need an account. Do not send identity documents or images of them. We aim to review reports within a few days. A report may lead to the image being removed from delivery and caches.</p>
      <h2>Usage limits</h2>
      <p>To keep the service available, some actions are limited. Examples: a few email codes per hour, a limited number of avatar imports, uploads, claim checks, and key changes per hour, and short lockouts after repeated failed sign-ins or wrong codes. If you hit a limit, the page tells you how long to wait. Each account also has caps on stored items, such as 3 avatar images on Free and 20 on Plus, up to 10 linked emails, and up to 10 profile links.</p>
      <h2>Appeals</h2>
      <p>If we blocked your image and you think that was a mistake, write to the operator contact listed on the home page and include your handle and the image. Someone other than the original reviewer will look at it, and we will reply with the outcome. An image that is unblocked is served again after caches refresh.</p>
    </PageMain>
  )
}
