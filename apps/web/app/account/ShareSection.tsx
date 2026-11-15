import { Button } from '../../components/Button'
import { Section } from '../../components/Page'
import { COPY } from '../../lib/copy'
import { EXPORT_LINKS, QR_CENTERS, exportUrl, qrImageUrl } from '../../lib/profile-share'

const DELIVERY_URL = process.env.DELIVERY_URL ?? 'http://localhost:3001'
const PUBLIC_DELIVERY_URL = process.env.PUBLIC_DELIVERY_URL || DELIVERY_URL

/** The one place for sharing: the QR code with its target picker, and the profile file and QR downloads. */
export function ShareSection({ handle, qrUrl, svg, target, platforms }: { handle: string | null; qrUrl: string | null; svg: string | null; target: string; platforms: Map<string, string> }) {
  if (!handle || !svg || !qrUrl) {
    return (
      <Section title={COPY.share.title} id="share">
        <p>{COPY.share.unavailable}</p>
      </Section>
    )
  }
  const svgHref = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  return (
    <Section title={COPY.share.title} id="share" intro={COPY.share.intro}>
      <form method="get" action="/account#share">
        <label>
          QR code target{' '}
          <select name="qr" defaultValue={target}>
            <option value="">Profile page</option>
            {[...platforms].map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>{' '}
        <Button type="submit">Update</Button>
      </form>
      <p>
        <img src={svgHref} alt={`QR code for ${qrUrl}`} width={256} height={256} className="h-auto max-w-full" />
      </p>
      <p>
        <code className="break-all">{qrUrl}</code>
      </p>
      <h3 className="text-base">Download your QR code</h3>
      <ul aria-label="Download QR code" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        <li>
          <a href={svgHref} download={`${handle}-qr.svg`}>Download SVG</a>
        </li>
        {QR_CENTERS.map((c) => (
          <li key={c.center}>
            <a href={qrImageUrl(PUBLIC_DELIVERY_URL, handle, c.center, 1024)} download={`${handle}-qr.png`}>Download QR code, {c.label.toLowerCase()} (PNG)</a>
          </li>
        ))}
      </ul>
      <h3 className="text-base">Download your profile</h3>
      <ul aria-label="Download profile" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {EXPORT_LINKS.map((f) => (
          <li key={f.format}>
            <a href={exportUrl(PUBLIC_DELIVERY_URL, handle, f.format)} download>Download {f.label}</a>
          </li>
        ))}
      </ul>
    </Section>
  )
}
