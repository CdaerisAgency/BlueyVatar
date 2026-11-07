import { createElement, type ImgHTMLAttributes, type ReactElement } from 'react'
import { avatarUrl, type AvatarUrlOptions } from './index.js'

export type AvatarProps = Omit<AvatarUrlOptions, 'key'> & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height' | 'alt'> & {
  /** Required for accessibility. Use an empty string for a decorative avatar. */
  alt: string
  /** Publishable key (`pk_...`). Named differently from `key` because React reserves that prop. */
  publishableKey?: string
}

/**
 * Square avatar image. Defaults: `referrerPolicy="no-referrer"` (spec section 9) and `loading="lazy"`.
 * Width and height follow `size` (default 80), so the layout does not shift while the image loads.
 */
export function Avatar(props: AvatarProps): ReactElement {
  const { hash, handle, did, size, default: def, forceDefault, rating, format, quality, publishableKey, name, baseUrl, alt, ...img } = props
  const url = avatarUrl({ hash, handle, did, size, default: def, forceDefault, rating, format, quality, key: publishableKey, name, baseUrl })
  const px = size ?? 80
  return createElement('img', { referrerPolicy: 'no-referrer', loading: 'lazy', width: px, height: px, ...img, alt, src: url })
}
