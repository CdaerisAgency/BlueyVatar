import { Button } from '../../components/Button'
import { Field } from '../../components/Field'
import { Section } from '../../components/Page'
import { addEmail, linkEmail } from '../actions'
import { HOLD_DAYS, MAX_LINKED_EMAILS } from '../../lib/email-policy'

/** The two ways to link an email: from the sign-in account, or by code. */
export function LinkEmailSection() {
  return (
    <Section title="Link email" id="link-email" intro={`You can link up to ${MAX_LINKED_EMAILS} emails. An address you unlink is held for ${HOLD_DAYS} days: only this account can link it again until then.`}>
    <p>We keep the address you link so we can show it here and tell you if a claim is removed or your email moves to another account. It is deleted when you unlink it or delete your data.</p>
    <form action={linkEmail}>
      <Button type="submit" variant="primary">Use the email from my account</Button>
    </form>
    <form action={addEmail}>
      <Field prefix="email" name="email" label="Add another email by code" required>
        <input id="email-email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Button type="submit" variant="primary">Send code</Button>
    </form>
    </Section>
  )
}
