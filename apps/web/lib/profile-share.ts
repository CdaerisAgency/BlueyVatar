// Client-safe: no imports from @blueyvatar/core or node: modules. Builds the download and QR URLs
// that the delivery service serves (issue #242). The delivery service renders the files.
export const EXPORT_LINKS = [
  { format: 'json', label: 'JSON' },
  { format: 'md', label: 'Markdown' },
  { format: 'vcf', label: 'vCard' },
] as const
export type ExportLinkFormat = (typeof EXPORT_LINKS)[number]['format']

export const QR_CENTERS = [
  { center: 'none', label: 'Plain' },
  { center: 'logo', label: 'With logo' },
  { center: 'avatar', label: 'With avatar' },
] as const

const trim = (base: string) => base.replace(/\/+$/, '')

/**
 * Export URL. A handle that itself ends in .json, .md, or .vcf uses ?format= so the suffix cannot
 * be read as part of the handle.
 */
export function exportUrl(deliveryBase: string, handle: string, format: ExportLinkFormat): string {
  const h = encodeURIComponent(handle)
  return /\.(json|md|vcf)$/i.test(handle) ? `${trim(deliveryBase)}/profile/${h}?format=${format}` : `${trim(deliveryBase)}/profile/${h}.${format}`
}

export function qrImageUrl(deliveryBase: string, handle: string, center: 'none' | 'logo' | 'avatar', size: number): string {
  return `${trim(deliveryBase)}/qr/${encodeURIComponent(handle)}.png?s=${size}&center=${center}`
}
