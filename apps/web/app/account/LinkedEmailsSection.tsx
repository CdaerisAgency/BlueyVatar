import { Button } from '../../components/Button'
import { EmptyState, Section } from '../../components/Page'
import { makePrimary, unlink } from '../actions'
import { COPY } from '../../lib/copy'
import { MAX_LINKED_EMAILS } from '../../lib/email-policy'
import type { LinkedEmailView } from '../../lib/linked-emails'
import type { getStore } from '../../lib/store'
import LinkedEmail from './LinkedEmail'

type Links = Awaited<ReturnType<ReturnType<typeof getStore>['links']['list']>>

/** The owner's linked emails, each with make-primary and unlink buttons. */
export function LinkedEmailsSection({ links, emails }: { links: Links; emails: LinkedEmailView[] }) {
  return (
    <Section
      id="linked-emails"
      title={<>{COPY.linkedEmails.title} <small className="text-base font-normal text-bv-ink-2">({links.length} of {MAX_LINKED_EMAILS})</small></>}
      intro={COPY.linkedEmails.intro}
    >
    {links.length === 0 ? (
      <EmptyState action={{ href: '#link-email', label: COPY.linkedEmails.emptyAction }}>{COPY.linkedEmails.empty}</EmptyState>
    ) : (
      <ul className="m-0 list-none space-y-4 p-0">
        {links.map((l, i) => (
          <li key={l.emailHash}>
            <LinkedEmail item={emails[i]!}>
              {!l.primary && (
                <form action={makePrimary} className="inline">
                  <input type="hidden" name="hash" value={l.emailHash} />
                  <Button type="submit">Make primary</Button>
                </form>
              )}
              <form action={unlink} className="inline">
                <input type="hidden" name="hash" value={l.emailHash} />
                <Button type="submit" variant="danger">Unlink</Button>
              </form>
            </LinkedEmail>
          </li>
        ))}
      </ul>
    )}
    </Section>
  )
}
