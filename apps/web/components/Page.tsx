import type { HTMLAttributes, ReactNode } from 'react'

/** Direct children that are forms, sections, or lists become white cards. */
const autoCards = [
  '[&>form]:bv-card [&>form]:grid [&>form]:gap-3.5 [&>form>:last-child]:mb-0',
  '[&>section]:bv-card [&>section>:last-child]:mb-0',
  '[&>ul]:bv-card [&>ul]:list-none',
  '[&>ul>li]:border-t-[1.5px] [&>ul>li]:border-bv-line [&>ul>li]:py-3',
  '[&>ul>li:first-child]:border-t-0 [&>ul>li:first-child]:pt-0 [&>ul>li:last-child]:pb-0',
].join(' ')

/** The id the skip link in SiteNav points at. */
export const MAIN_ID = 'main'

/** The page container for login, account, profile, and demo pages. Width, title size, and spacing come from the page standard in tokens.css. Account pages use the default width. */
export function PageMain({ narrow = false, children }: { narrow?: boolean; children: ReactNode }) {
  const width = narrow ? 'max-w-bv-narrow' : 'max-w-bv-page'
  return (
    <main id={MAIN_ID} tabIndex={-1} className={`focus:outline-none mx-auto w-full flex-auto px-4 pt-7 pb-14 sm:px-5 sm:pt-10 sm:pb-[72px] ${width} ${autoCards}`}>{children}</main>
  )
}

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bv-card [&>:last-child]:mb-0 ${className}`} {...rest} />
}

/** A callout with a 2px black border. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <Card role="note" className="border-2! border-bv-black!">
      {children}
    </Card>
  )
}

/** Wide tables scroll inside this box at phone width. */
export function TableBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="mb-5 overflow-x-auto rounded-xl border-[1.5px] border-bv-line bg-bv-white focus-visible:outline-offset-0">
      {children}
    </div>
  )
}
