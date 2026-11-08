import { EXPORT_LINKS, QR_CENTERS, exportUrl, qrImageUrl } from '../lib/profile-share'

/**
 * Download links for the profile files and the QR code of the profile page. The files and the
 * image come from the delivery service, so nothing here touches @blueyvatar/core.
 */
export function ProfileShare({ handle, deliveryBase, profileUrl }: { handle: string; deliveryBase: string; profileUrl: string }) {
  return (
    <section aria-labelledby="share-heading" className="mt-8 text-center">
      <h2 id="share-heading" className="mb-2 text-base">Download and share</h2>
      <ul aria-label="Download profile" className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0">
        {EXPORT_LINKS.map((f) => (
          <li key={f.format}>
            <a href={exportUrl(deliveryBase, handle, f.format)} download>Download {f.label}</a>
          </li>
        ))}
      </ul>
      <details className="mt-4">
        <summary>QR code</summary>
        <p className="mt-3">
          {/* The image is rendered by the delivery service. It loads when this section opens. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrImageUrl(deliveryBase, handle, 'logo', 256)} alt={`QR code for ${profileUrl}`} loading="lazy" width={256} height={256} className="mx-auto h-auto max-w-full" />
        </p>
        <ul aria-label="Download QR code" className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-2 p-0">
          {QR_CENTERS.map((c) => (
            <li key={c.center}>
              <a href={qrImageUrl(deliveryBase, handle, c.center, 1024)} download={`${handle}-qr.png`}>Download QR code, {c.label.toLowerCase()} (PNG)</a>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
