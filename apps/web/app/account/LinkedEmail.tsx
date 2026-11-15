import type { ReactNode } from 'react'
import { ButtonLink } from '../../components/Button'
import { COPY } from '../../lib/copy'
import type { LinkedEmailView } from '../../lib/linked-emails'

const C = COPY.linkedEmails

/**
 * One linked email for the owner. The address leads when it is stored. An older link has no stored address, so it says so
 * and offers "Link again". `children` are the row's action buttons (make primary, unlink).
 */
export default function LinkedEmail({ item, children }: { item: LinkedEmailView; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        {item.full ? (
          <span className="font-semibold break-all text-bv-black">{item.text}</span>
        ) : (
          <>
            <span className="font-semibold text-bv-black">{C.unsavedTitle}</span>
            <span className="block">{C.unsavedHelp}</span>
          </>
        )}
        {item.primary && <span className="ml-2 inline-block rounded-bv-pill bg-bv-black px-2.5 py-0.5 text-sm font-semibold text-bv-white">{C.primary}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!item.full && (
          <ButtonLink href="#link-email" variant="secondary">
            {C.linkAgain}
          </ButtonLink>
        )}
        {children}
      </div>
    </div>
  )
}
