import { EmptyState, Note, PageHeader, PageMain, Section } from '../../../components/Page'
import { Button } from '../../../components/Button'
import { Field } from '../../../components/Field'
import { requireDid } from '../../../lib/auth'
import { RepoError, blobUrl, getProfile, listImages, pdsUrl, repoSession, type StoredImage } from '../../../lib/repo'
import { resolvePlan } from '../../../lib/plan'
import { canUse, FRAME_COLORS, FRAME_STYLES } from '../../../lib/effects/catalog'
import { getEffectsStore } from '../../../lib/effects/store'
import { cancelAway, deleteFrame, saveAway, saveFrame } from './actions'

export const dynamic = 'force-dynamic'

const STATE_TEXT = {
  off: 'Out-of-office is off.',
  scheduled: 'Scheduled. It turns on by itself at the start of the first day.',
  active: 'On now. Your default image shows the out-of-office badge.',
  failed: 'It could not be switched on.',
} as const

export default async function EffectsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/effects')
  const { error, done } = await searchParams
  const plan = await resolvePlan(did)
  const row = await getEffectsStore().get(did)
  let images: StoredImage[] = []
  let pds = ''
  let timezone = 'UTC'
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[images, pds] = await Promise.all([listImages(session), pdsUrl(session)])
    const tz = (await getProfile(session).catch(() => null))?.value.timezone
    if (typeof tz === 'string' && tz) timezone = tz
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const renders = new Set([row.frameImageRkey, row.awayImageRkey])
  const originals = images.filter((i) => !renders.has(i.rkey))
  const framed = images.find((i) => i.rkey === row.frameImageRkey)
  const canFrame = canUse('frame:ring', plan)
  const awayOn = row.awayState === 'active'
  const defaultSource = row.frameSourceRkey ?? originals.find((i) => i.value.isDefault)?.rkey ?? originals[0]?.rkey

  return (
    <PageMain>
      <PageHeader title="Effects" intro="Add a frame or an out-of-office badge to your avatar. Each look is saved as a new image." />
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      <Note>
        <p>Effects are drawn from your original image and saved to your Bluesky account like any upload, so they are public, count toward your image limit, and go through the same checks. Your original stays as it is.</p>
      </Note>

      <Section title="Out-of-office badge" intro="Free. Shows a small badge on your default image between two dates, then brings your previous default back.">
        <p>{STATE_TEXT[row.awayState]}</p>
        {row.awayStartOn && row.awayEndOn && <p>{row.awayStartOn} to {row.awayEndOn} ({row.awayTimezone}).</p>}
        {row.awayError && <p role="alert">{row.awayError}</p>}
        {!awayOn && !loadError && (
          <form action={saveAway}>
            <Field prefix="away" name="start" label="First day" required><input type="date" name="start" id="away-start" required defaultValue={row.awayStartOn ?? ''} /></Field>
            <Field prefix="away" name="end" label="Last day" required><input type="date" name="end" id="away-end" required defaultValue={row.awayEndOn ?? ''} /></Field>
            <Field prefix="away" name="timezone" label="Time zone" hint="The days start and end in this zone. Example: America/New_York." required>
              <input type="text" name="timezone" id="away-timezone" required defaultValue={row.awayTimezone ?? timezone} />
            </Field>
            <Button type="submit" variant="primary">Save out-of-office dates</Button>
          </form>
        )}
        {row.awayState !== 'off' && (
          <form action={cancelAway}>
            <Button type="submit" variant="secondary">{awayOn ? 'Turn off now' : 'Cancel out-of-office'}</Button>
          </form>
        )}
      </Section>

      <Section title="Profile frame" intro="Plus plan. A ring around a round version of your picture.">
        {!canFrame ? (
          <EmptyState action={{ href: '/account/billing', label: 'See the Plus plan' }}>Frames are part of the Plus plan.</EmptyState>
        ) : originals.length === 0 && !loadError ? (
          <EmptyState action={{ href: '/account/avatars#upload', label: 'Upload an image' }}>Upload an image first, then frame it here.</EmptyState>
        ) : (
          !loadError && (
            <>
              {framed && (
                <p>
                  {/* The blob is served by the user's home server, so next/image optimization does not apply. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={blobUrl(pds, did, framed.value.image.ref.$link)} alt="Your framed avatar" className="size-24 object-cover" referrerPolicy="no-referrer" />
                </p>
              )}
              <form action={saveFrame}>
                <Field prefix="frame" name="source" label="Image to frame">
                  <select name="source" id="frame-source" defaultValue={defaultSource}>
                    {originals.map((i) => <option key={i.rkey} value={i.rkey}>{i.value.alt || `Image from ${i.value.createdAt.slice(0, 10)}`}</option>)}
                  </select>
                </Field>
                <fieldset>
                  <legend>Style</legend>
                  {FRAME_STYLES.map((s) => (
                    <label key={s.id}><input type="radio" name="style" value={s.id} defaultChecked={(row.frameStyle ?? 'ring') === s.id} /> {s.label}. {s.hint}</label>
                  ))}
                </fieldset>
                <fieldset>
                  <legend>Color</legend>
                  {FRAME_COLORS.map((c) => (
                    <label key={c.id}><input type="radio" name="color" value={c.id} defaultChecked={(row.frameColor ?? 'orange') === c.id} /> {c.label}</label>
                  ))}
                </fieldset>
                <Button type="submit" variant="primary" disabled={awayOn}>Save frame</Button>
                {awayOn && <p>Turn off out-of-office to change your frame.</p>}
              </form>
              {framed && (
                <form action={deleteFrame}>
                  <Button type="submit" variant="danger" disabled={awayOn}>Remove frame</Button>
                </form>
              )}
            </>
          )
        )}
      </Section>
    </PageMain>
  )
}
