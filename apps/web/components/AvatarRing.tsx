/** The sizes the design allows. The hero uses 380. */
export type RingSize = 36 | 56 | 88 | 380

interface Props {
  src: string
  /** Alt text. Pass an empty string when the image is decorative. */
  alt: string
  size?: RingSize
  referrerPolicy?: 'no-referrer'
}

const WIDTH: Record<RingSize, string> = { 36: 'w-9', 56: 'w-14', 88: 'w-[88px]', 380: 'w-[380px]' }
const LINE: Record<RingSize, string> = { 36: 'border-[1.5px]', 56: 'border-2', 88: 'border-2', 380: 'border-[3px]' }

/** Three layers: an orange disc at 18% opacity, a black ring inset, and the image in a circle inside. */
export default function AvatarRing({ src, alt, size = 88, referrerPolicy }: Props) {
  return (
    <span className={`relative block aspect-square max-w-full flex-none ${WIDTH[size]}`}>
      <span aria-hidden="true" className="absolute inset-0 rounded-full bg-bv-orange opacity-[0.18]" />
      <span aria-hidden="true" className={`absolute inset-[9.5%] rounded-full border-solid border-bv-black ${LINE[size]}`} />
      {/* Avatars can be served by a PDS or the delivery app, so next/image optimization does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="absolute inset-[16%] size-[68%] rounded-full bg-bv-white object-cover"
        src={src}
        alt={alt}
        width={size}
        height={size}
        {...(referrerPolicy ? { referrerPolicy } : {})}
      />
    </span>
  )
}
