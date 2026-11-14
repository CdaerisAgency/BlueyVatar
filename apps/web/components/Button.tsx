import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'
type Size = 'md' | 'lg'

const base =
  'inline-block cursor-pointer rounded-bv-pill border-[1.5px] text-center leading-[1.2] font-semibold no-underline disabled:cursor-not-allowed disabled:border-bv-ink-3 disabled:bg-bv-line disabled:text-bv-ink-3'
const variants: Record<Variant, string> = {
  primary: 'border-bv-black bg-bv-orange text-bv-black hover:shadow-[0_0_0_3px_var(--color-bv-line)]',
  secondary: 'border-bv-black bg-transparent text-bv-black hover:bg-bv-line',
  danger: 'border-bv-danger bg-bv-danger text-bv-white hover:shadow-[0_0_0_3px_var(--color-bv-line)]',
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

/** Primary is the orange pill with black text, for the main action. Secondary is the 1.5px black outline. Danger is the red pill for actions that delete or revoke. Name the action in the text. */
export function Button({ variant, size, className = '', ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonClass(variant, size, className)} {...rest} />
}

export function ButtonLink({ variant, size, className = '', ...rest }: Common & ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />
}
