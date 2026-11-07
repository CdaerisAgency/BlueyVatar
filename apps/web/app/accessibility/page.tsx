import { PageMain } from '../../components/Page'
import { pageMetadata } from '../../lib/site'
export const metadata = pageMetadata('/accessibility', 'Accessibility | blueyvatar', 'Our accessibility commitment, the standard we test against, and how to report a barrier.')

export default function AccessibilityPage() {
  return (
    <PageMain>
      <h1>Accessibility</h1>
      <p>We want everyone to be able to use blueyvatar, including people who rely on a keyboard, a screen reader, zoom, or reduced motion. We aim to meet WCAG 2.2 level AA on our public pages and our account pages.</p>
      <h2>What we do</h2>
      <ul>
        <li>Every page has a skip link, a single main landmark, and a logical heading order.</li>
        <li>Every form field has a visible label. Errors are announced and tied to the field they describe.</li>
        <li>Our color palette is checked against the WCAG contrast ratios in an automated test, including focus rings and placeholder text.</li>
        <li>Animations respect the reduced motion setting in your system.</li>
        <li>Hovercards open on keyboard focus, close with Escape, and never trap focus.</li>
        <li>An automated axe-core scan runs on our main pages in every change to the code.</li>
      </ul>
      <h2>Known limits</h2>
      <p>Automated checks find only part of the problems that people meet. Avatars and gallery images come from your own repository, so their alt text is only as good as the text the owner wrote. Hosted profile pages show it when it exists.</p>
      <h2>Tell us about a barrier</h2>
      <p>If something on blueyvatar is hard to use, write to support@blueyvatar.com with the page address and what happened. We read every report and reply with a fix date or a workaround.</p>
    </PageMain>
  )
}
