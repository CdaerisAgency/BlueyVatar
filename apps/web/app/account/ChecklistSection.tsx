import Link from 'next/link'
import { Button } from '../../components/Button'
import { Section } from '../../components/Page'
import { checklist, showChecklist, type ChecklistPrefs } from '../../lib/onboarding'
import { setChecklistShown } from './checklist/actions'

/** The "Get started" checklist, or the line that brings it back once it is complete and hidden. */
export function ChecklistSection({ list, prefs }: { list: ReturnType<typeof checklist>; prefs: ChecklistPrefs }) {
  return (
    <>
      {showChecklist(list.complete, prefs.showAgain) && (
        <Section title={`Get started (${list.done} of ${list.total} done)`} id="checklist" intro={list.complete ? 'Everything is set up.' : 'Work through these in any order.'}>
          <ol>
            {list.steps.map((st) => (
              <li key={st.id}>
                <span aria-hidden="true">{st.done ? '[x]' : '[ ]'}</span> <Link href={st.href}>{st.title}</Link>
                <span className="sr-only">{st.done ? ' (done)' : ' (to do)'}</span>. {st.hint}
              </li>
            ))}
          </ol>
          {list.complete && (
            <form action={setChecklistShown}>
              <input type="hidden" name="show" value="0" />
              <Button type="submit">Hide checklist</Button>
            </form>
          )}
        </Section>
      )}
      {list.complete && !prefs.showAgain && (
        <div>
          Setup is complete. <form action={setChecklistShown} className="inline"><input type="hidden" name="show" value="1" /><button type="submit" className="cursor-pointer border-0 bg-transparent p-0 text-bv-blue underline">Show the checklist again</button></form>
        </div>
      )}
    </>
  )
}
