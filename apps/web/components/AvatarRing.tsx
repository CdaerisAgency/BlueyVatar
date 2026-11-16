/** The sizes the design allows. The hero uses 380. */
export type RingSize = 36 | 56 | 88 | 380

interface Props {
  src: string
  /** Alt text. Pass an empty string when the image is decorative. */
  alt: string
  size?: RingSize
  referrerPolicy?: 'no-referrer'
  /** A WebP srcset. When set, the image renders in a <picture> with `src` as the fallback. */
  webpSrcSet?: string
  /** The `sizes` attribute that goes with `webpSrcSet`. */
  sizes?: string
  /** The image is the page's largest paint: load it first and never lazily. */
  priority?: boolean
}

const WIDTH: Record<RingSize, string> = { 36: 'w-9', 56: 'w-14', 88: 'w-[88px]', 380: 'w-[380px]' }
const LINE: Record<RingSize, string> = { 36: 'border-[1.5px]', 56: 'border-2', 88: 'border-2', 380: 'border-[3px]' }

/** Three layers: an orange disc at 18% opacity, a black ring inset, and the image in a circle inside. */
export default function AvatarRing({ src, alt, size = 88, referrerPolicy, webpSrcSet, sizes, priority }: Props) {
  return (
    <span className={`relative block aspect-square max-w-full flex-none ${WIDTH[size]}`}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-bv-orange opacity-[0.18]" />
      <span aria-hidden="true" className={`absolute inset-[9.5%] rounded-full border-solid border-bv-black ${LINE[size]}`} />
      {/* Avatars can be served by a PDS or the delivery app, so next/image optimization does not apply. */}
      <picture>
        {webpSrcSet && <source type="image/webp" srcSet={webpSrcSet} {...(sizes ? { sizes } : {})} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="absolute inset-[16%] size-[68%] rounded-full bg-bv-white object-cover"
          src={src}
          alt={alt}
          width={size}
          height={size}
          {...(priority ? { fetchPriority: 'high' as const } : {})}
          {...(referrerPolicy ? { referrerPolicy } : {})}
        />
      </picture>
    </span>
  )
}
