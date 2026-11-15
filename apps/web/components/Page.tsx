import Link from 'next/link'
import type { HTMLAttributes, ReactNode } from 'react'
import { ButtonLink } from './Button'

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

/**
 * The top of every account page: the one h1, an optional one-sentence intro, and an optional row of actions.
 * The title is the same words as the side menu label (account-nav.test.ts checks this). No other element is styled like a page title.
 */
export function PageHeader({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header>
      <h1>{title}</h1>
      {intro && <p className="bv-intro">{intro}</p>}
      {actions && <div className="mb-5 flex flex-wrap gap-3">{actions}</div>}
    </header>
  )
}

/** A link from a sub-page to its parent page, placed above the PageHeader. The label names the parent ("Back to avatars"). */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="mb-3 text-bv-small">
      <Link href={href}>
        <span aria-hidden="true">&larr; </span>
        {children}
      </Link>
    </p>
  )
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * One block of a page: an h2, an optional one-line description, then the content. Directly inside PageMain it becomes a card.
 * Use `tone="danger"` for destructive actions. Pass `id` when other links point at the section.
 */
export function Section({ title, intro, id, tone = 'default', children }: { title: ReactNode; intro?: ReactNode; id?: string; tone?: 'default' | 'danger'; children?: ReactNode }) {
  const hid = `${id ?? (typeof title === 'string' ? slug(title) : 'section')}-title`
  const cls = tone === 'danger' ? 'bv-block border-2! border-bv-danger!' : 'bv-block'
  return (
    <section id={id} aria-labelledby={hid} className={cls}>
      <h2 id={hid}>{title}</h2>
      {intro && <p>{intro}</p>}
      {children}
    </section>
  )
}

/** What a list or table shows when it has no rows: one sentence that says what is missing, and the next action when there is one. */
export function EmptyState({ children, action }: { children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="bv-empty">
      <p>{children}</p>
      {action && <ButtonLink href={action.href} variant="secondary">{action.label}</ButtonLink>}
    </div>
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

/** The error, done and load-error lines under a page header. Each shows only when it has text. */
export function Notices({ error, done, loadError }: { error?: string | null; done?: string | null; loadError?: string | null }) {
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
    </>
  )
}
