'use server'

import { redirect } from 'next/navigation'
import { requireAdmin } from '../../../lib/admin/guard'
import { changeOffer, createOffer, endOffer, parseOffer } from '../../../lib/effects/grants'
import { limited } from '../../../lib/rate-guard'

const PATH = '/admin/effects'
const to = (key: string, value: string): never => redirect(`${PATH}?${key}=${encodeURIComponent(value)}`)

/** Creates an offer, or changes one when the form carries an id. Both are audited. */
export async function saveOffer(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const wait = await limited(['adminAction.did', 'adminAction.ip'], a.did)
  if (wait) return to('msg', wait)
  const text = (k: string) => String(form.get(k) ?? '')
  const id = Number(text('id') || 0)
  const parsed = await parseOffer(a.pool, {
    effect: text('effect'), name: text('name'), startDay: text('start'), endDay: text('end'),
    audience: text('audience'), planName: text('plan'), accounts: text('accounts'), notify: form.get('notify') === 'on',
  })
  if (!parsed.ok) return to('msg', parsed.error)
  if (id) {
    const out = await changeOffer(a.pool, a.did, id, parsed.value)
    return to('msg', out.ok ? 'Offer changed.' : out.error)
  }
  await createOffer(a.pool, a.did, parsed.value)
  return to('msg', 'Offer created.')
}

/** Ends an offer now. It leaves the effects page; avatars already rendered with it keep working. */
export async function endOfferAction(form: FormData): Promise<void> {
  const a = await requireAdmin()
  const id = Number(form.get('id'))
  if (!Number.isSafeInteger(id)) return to('msg', 'Unknown offer.')
  const out = await endOffer(a.pool, a.did, id)
  return to('msg', out.ok ? 'Offer ended. Avatars already made with it keep working.' : out.error)
}
