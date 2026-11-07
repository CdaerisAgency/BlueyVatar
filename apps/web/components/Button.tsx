import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps } from 'react'

type Variant = 'primary' | 'secondary'
type Size = 'md' | 'lg'

const base =
  'inline-block cursor-pointer rounded-bv-pill border-[1.5px] border-bv-black text-center leading-[1.2] font-semibold text-bv-black no-underline disabled:cursor-not-allowed disabled:border-bv-ink-3 disabled:bg-bv-line disabled:text-bv-ink-3'
const variants: Record<Variant, string> = {
  primary: 'bg-bv-orange hover:shadow-[0_0_0_3px_var(--color-bv-line)]',
  secondary: 'bg-transparent hover:bg-bv-line',
}
const sizes: Record<Size, string> = {
  md: 'px-[22px] py-3 text-[15px]',
  lg: 'px-7 py-4 text-[17px]',
}

export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md', extra = '') =>
  `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim()

interface Common {
  variant?: Variant
  size?: Size
}

/** Primary is the orange pill with black text. Secondary is the 1.5px black outline. */
export function Button({ variant, size, className = '', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonClass(variant, size, className)} {...rest} />
}

export function ButtonLink({ variant, size, className = '', ...rest }: Common & ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />
}
