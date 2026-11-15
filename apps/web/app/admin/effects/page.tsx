import { Button } from '../../../components/Button'
import { requireAdmin } from '../../../lib/admin/guard'
import { isLive, listOffers, offerableEffects, type Offer } from '../../../lib/effects/grants'
import { AdminPage, fmt } from '../AdminBits'
import { endOfferAction, saveOffer } from './actions'

const day = (d: Date) => d.toISOString().slice(0, 10)
const lastDay = (o: Offer) => day(new Date(o.endsAt.getTime() - 1))
const who = (o: Offer) => (o.audience === 'everyone' ? 'everyone' : o.audience === 'plan' ? `the ${o.planName} plan` : `${o.dids.length} listed account${o.dids.length === 1 ? '' : 's'}`)
const state = (o: Offer, now: Date) => (o.endedAt ? `ended early ${fmt(o.endedAt)}` : o.endsAt <= now ? 'over' : isLive(o, now) ? 'live' : 'scheduled')

export const metadata = { title: 'Free effects' }

export default async function EffectOffersPage({ searchParams }: { searchParams: Promise<{ msg?: string; edit?: string }> }) {
  const { did, pool } = await requireAdmin()
  const sp = await searchParams
  const offers = await listOffers(pool)
  const now = new Date()
  const editing = offers.find((o) => String(o.id) === sp.edit && !o.endedAt && o.endsAt > now)
  return (
    <AdminPage did={did} title="Free effects" msg={sp.msg}>
      <p>Make an effect free for a window. An avatar already made with it keeps working after the offer ends. Days are UTC and the last day is included.</p>
      <section aria-label={editing ? 'Change offer' : 'New offer'}>
        <h2>{editing ? `Change offer ${editing.id}` : 'New offer'}</h2>
        <form action={saveOffer} key={editing?.id ?? 'new'}>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <label>Effect{' '}
            <select name="effect" required defaultValue={editing?.effect ?? ''}>
              <option value="" disabled>Choose an effect</option>
              {offerableEffects().map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label>Name shown to people <input name="name" required maxLength={80} defaultValue={editing?.name ?? ''} /></label>
          <label>First day <input type="date" name="start" required defaultValue={editing ? day(editing.startsAt) : ''} /></label>
          <label>Last day <input type="date" name="end" required defaultValue={editing ? lastDay(editing) : ''} /></label>
          <fieldset>
            <legend>Who gets it</legend>
            <label><input type="radio" name="audience" value="everyone" defaultChecked={!editing || editing.audience === 'everyone'} /> Everyone</label>
            <label><input type="radio" name="audience" value="plan" defaultChecked={editing?.audience === 'plan'} /> One plan{' '}
              <select name="plan" defaultValue={editing?.planName ?? 'free'} aria-label="Plan">
                <option value="free">Free</option>
                <option value="plus">Plus</option>
              </select>
            </label>
            <label><input type="radio" name="audience" value="accounts" defaultChecked={editing?.audience === 'accounts'} /> Listed accounts</label>
            <label>Accounts, one DID or handle per line, up to 500
              <textarea name="accounts" rows={4} defaultValue={editing?.dids.join('\n') ?? ''} />
            </label>
          </fieldset>
          <label><input type="checkbox" name="notify" defaultChecked={editing?.notify ?? false} /> Notify people: one email when the offer starts (to those who have not turned offer emails off) and a banner on account pages during the window. Leave off to add it quietly.</label>
          <Button type="submit" variant="primary">{editing ? 'Save changes' : 'Create offer'}</Button>
          {editing && <a href="/admin/effects">Cancel</a>}
        </form>
      </section>
      <section aria-label="Offers">
        <h2>Offers</h2>
        {offers.length === 0 ? <p>No offers yet.</p> : (
          <ul>
            {offers.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong> ({o.effect}) for {who(o)}, {day(o.startsAt)} to {lastDay(o)}, {state(o, now)}. {o.notify ? 'Notifies people.' : 'Quiet.'}
                {!o.endedAt && o.endsAt > now && (
                  <>
                    {' '}<a href={`/admin/effects?edit=${o.id}`}>Change</a>
                    <form action={endOfferAction} className="inline"><input type="hidden" name="id" value={o.id} /><Button type="submit" variant="danger">End now</Button></form>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminPage>
  )
}
