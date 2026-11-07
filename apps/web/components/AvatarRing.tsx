import type { CSSProperties } from 'react'

/** The sizes the design allows. The hero uses 380. */
export type RingSize = 36 | 56 | 88 | 380

interface Props {
  src: string
  /** Alt text. Pass an empty string when the image is decorative. */
  alt: string
  size?: RingSize
  referrerPolicy?: 'no-referrer'
}

const LINE: Record<RingSize, number> = { 36: 1.5, 56: 2, 88: 2, 380: 3 }

/** Three layers: an orange disc at 18% opacity, a black ring inset, and the image in a circle inside. */
export default function AvatarRing({ src, alt, size = 88, referrerPolicy }: Props) {
  const style = { '--bv-ring-size': `${size}px`, '--bv-ring-line': `${LINE[size]}px` } as CSSProperties
  return (
    <span className="bv-ring" style={style}>
      <span className="bv-ring-glow" aria-hidden="true" />
      <span className="bv-ring-line" aria-hidden="true" />
      {/* Avatars can be served by a PDS or the delivery app, so next/image optimization does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="bv-ring-img" src={src} alt={alt} width={size} height={size} {...(referrerPolicy ? { referrerPolicy } : {})} />
    </span>
  )
}
