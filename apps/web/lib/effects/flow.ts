import type { StoredImage } from '../repo'
import { canAddImage, limitMessage, type Check, type ImageMime, type Plan } from '../records'
import { canUse, parseFrame, type Look } from './catalog'
import type { RenderInput } from './render'
import type { EffectsRow, EffectsStore } from './store'
import { validateAway } from './time'

/**
 * The effects actions, written against small ports so tests run without a repository, a database or sharp.
 * Every render becomes a normal image record in the user's repository, goes through the upload steps
 * (prepare, then screening) first, and counts toward the plan's image limit. Delivery never applies effects.
 */
export interface RepoPort {
  /** Avatar images only. */
  list(): Promise<StoredImage[]>
  /** The stored bytes of an image record. */
  blob(img: StoredImage): Promise<Check<Uint8Array>>
  /** Creates an image record and, when asked, makes it the default. Returns its record key. */
  add(bytes: Uint8Array, mime: ImageMime, meta: { alt?: string | undefined; labels?: unknown }, makeDefault: boolean): Promise<string>
  remove(rkey: string): Promise<void>
  setDefault(img: StoredImage): Promise<void>
}

export interface FlowDeps {
  store: EffectsStore
  repo: RepoPort
  plan(): Promise<Plan>
  render(input: RenderInput): Promise<Check<{ bytes: Uint8Array; mime: 'image/png' }>>
  /** Same steps as an upload: validate and strip metadata, before screening. */
  prepare(bytes: Uint8Array): Promise<Check<{ bytes: Uint8Array; mime: ImageMime }>>
  screen(bytes: Uint8Array, mime: ImageMime): Promise<{ ok: true } | { ok: false; error: string }>
  /** Pushes the new default to apps the user turned on. Returns a notice or null. */
  push(): Promise<string | null>
  now(): Date
}

export type Result = { ok: true; message: string } | { ok: false; error: string }
const fail = (error: string): Result => ({ ok: false, error })
const done = (message: string): Result => ({ ok: true, message })
const withNote = (message: string, note: string | null) => (note ? `${message} ${note}` : message)

/** Records of ours: renders are never used as the source of another render. */
const isRender = (row: EffectsRow, rkey: string) => rkey === row.frameImageRkey || rkey === row.awayImageRkey

async function renderToRecord(deps: FlowDeps, base: StoredImage, source: StoredImage, look: Look, makeDefault: boolean): Promise<Check<string>> {
  const bytes = await deps.repo.blob(source)
  if (!bytes.ok) return bytes
  const out = await deps.render({ bytes: bytes.value, crop: source.value.crop, look })
  if (!out.ok) return out
  const prepared = await deps.prepare(out.value.bytes)
  if (!prepared.ok) return prepared
  const screened = await deps.screen(prepared.value.bytes, prepared.value.mime)
  if (!screened.ok) return { ok: false, error: screened.error }
  const rkey = await deps.repo.add(prepared.value.bytes, prepared.value.mime, { alt: base.value.alt, labels: base.value.labels }, makeDefault)
  return { ok: true, value: rkey }
}

function frameLook(row: EffectsRow): Look['frame'] | undefined {
  const f = row.frameStyle && row.frameColor ? parseFrame(row.frameStyle, row.frameColor) : null
  return f?.ok ? f.value : undefined
}

/** Render a frame from an original image and make the render the default. Plus and above. */
export async function applyFrame(deps: FlowDeps, did: string, input: { sourceRkey: string; style: string; color: string }): Promise<Result> {
  const frame = parseFrame(input.style, input.color)
  if (!frame.ok) return fail(frame.error)
  const plan = await deps.plan()
  if (!canUse(`frame:${frame.value.style}`, plan)) return fail('Frames are part of the Plus plan.')
  const row = await deps.store.get(did)
  if (row.awayState === 'active') return fail('Out-of-office is on. Turn it off before you change your frame.')
  const images = await deps.repo.list()
  const source = images.find((i) => i.rkey === input.sourceRkey)
  if (!source || isRender(row, source.rkey)) return fail('Choose one of your original images.')
  const old = row.frameImageRkey ? images.find((i) => i.rkey === row.frameImageRkey) : undefined
  // The old render is replaced, so it does not count toward the limit once the new one is saved.
  if (!canAddImage(images.length - (old ? 1 : 0), plan)) return fail(limitMessage(plan))
  // Render and screen first, so a failure leaves the old frame as it was. The old record goes only after the new bytes are known good.
  const bytes = await deps.repo.blob(source)
  if (!bytes.ok) return fail(bytes.error)
  const out = await deps.render({ bytes: bytes.value, crop: source.value.crop, look: { frame: frame.value } })
  if (!out.ok) return fail(out.error)
  const prepared = await deps.prepare(out.value.bytes)
  if (!prepared.ok) return fail(prepared.error)
  const screened = await deps.screen(prepared.value.bytes, prepared.value.mime)
  if (!screened.ok) return fail(screened.error)
  if (old) await deps.repo.remove(old.rkey)
  const rkey = await deps.repo.add(prepared.value.bytes, prepared.value.mime, { alt: source.value.alt, labels: source.value.labels }, true)
  await deps.store.patch(did, { frameStyle: frame.value.style, frameColor: frame.value.color, frameSourceRkey: source.rkey, frameImageRkey: rkey })
  return done(withNote('Frame saved. The framed image is now your default.', await deps.push()))
}

/** Delete the render. If it was the default, the original it came from becomes the default again. */
export async function removeFrame(deps: FlowDeps, did: string): Promise<Result> {
  const row = await deps.store.get(did)
  if (row.awayState === 'active') return fail('Out-of-office is on. Turn it off before you change your frame.')
  const images = await deps.repo.list()
  const render = row.frameImageRkey ? images.find((i) => i.rkey === row.frameImageRkey) : undefined
  const source = row.frameSourceRkey ? images.find((i) => i.rkey === row.frameSourceRkey) : undefined
  let pushed: string | null = null
  if (render) {
    if (render.value.isDefault === true && source) await deps.repo.setDefault(source)
    await deps.repo.remove(render.rkey)
    pushed = await deps.push()
  }
  await deps.store.patch(did, { frameStyle: null, frameColor: null, frameSourceRkey: null, frameImageRkey: null })
  return done(withNote('Frame removed.', pushed))
}

/** Save an out-of-office window. It switches on by itself at the start. Free for everyone. */
export async function scheduleAway(deps: FlowDeps, did: string, input: { start: string; end: string; timezone: string }): Promise<Result> {
  const v = validateAway(input.start, input.end, input.timezone, deps.now())
  if (!v.ok) return fail(v.error)
  const row = await deps.store.get(did)
  if (row.awayState === 'active') return fail('Out-of-office is already on. Turn it off first to change the dates.')
  await deps.store.patch(did, {
    awayState: 'scheduled', awayStartOn: v.value.start, awayEndOn: v.value.end, awayTimezone: input.timezone,
    awayStartAt: v.value.startAt, awayEndAt: v.value.endAt, awayError: null, awayRetryAt: null,
  })
  return done('Out-of-office saved. It turns on at the start of the first day and off after the last day.')
}

/** Switch on: render the badge onto the default image and make that the default. */
async function switchOn(deps: FlowDeps, did: string, row: EffectsRow): Promise<Result> {
  const plan = await deps.plan()
  const images = await deps.repo.list()
  const current = images.find((i) => i.value.isDefault === true)
  if (!current) return fail('You have no default image to add the badge to.')
  if (!canAddImage(images.length, plan)) return fail(limitMessage(plan))
  // A framed default is rebuilt from its original so the frame and the badge are drawn once each.
  const framed = current.rkey === row.frameImageRkey
  const frameSource = framed && row.frameSourceRkey ? images.find((i) => i.rkey === row.frameSourceRkey) : undefined
  const source = frameSource ?? current
  const frame = frameSource ? frameLook(row) : undefined
  const look: Look = { badge: 'away', ...(frame ? { frame } : {}) }
  const rkey = await renderToRecord(deps, current, source, look, true)
  if (!rkey.ok) return fail(rkey.error)
  await deps.store.patch(did, { awayState: 'active', awayImageRkey: rkey.value, awayPrevDefaultRkey: current.rkey, awayError: null, awayRetryAt: null })
  return done(withNote('Out-of-office is on.', await deps.push()))
}

/** Switch off: bring the previous default back, delete the away image, clear the window. */
async function switchOff(deps: FlowDeps, did: string, row: EffectsRow): Promise<Result> {
  const images = await deps.repo.list()
  const away = row.awayImageRkey ? images.find((i) => i.rkey === row.awayImageRkey) : undefined
  let pushed: string | null = null
  if (away) {
    // Only restore when the away image is still the default. If the user chose another default meanwhile, that choice stands.
    if (away.value.isDefault === true) {
      const prev = row.awayPrevDefaultRkey ? images.find((i) => i.rkey === row.awayPrevDefaultRkey) : undefined
      const fallback = images.find((i) => i.rkey !== away.rkey)
      const back = prev ?? fallback
      if (back) await deps.repo.setDefault(back)
    }
    await deps.repo.remove(away.rkey)
    pushed = await deps.push()
  }
  await deps.store.patch(did, { awayState: 'off', awayImageRkey: null, awayPrevDefaultRkey: null, awayStartOn: null, awayEndOn: null, awayTimezone: null, awayStartAt: null, awayEndAt: null, awayError: null, awayRetryAt: null })
  return done(withNote('Out-of-office is off. Your previous default image is back.', pushed))
}

/** The user turns it off early (or cancels a window that has not started). */
export async function turnOffAway(deps: FlowDeps, did: string): Promise<Result> {
  const row = await deps.store.get(did)
  if (row.awayState === 'off') return done('Out-of-office is already off.')
  return switchOff(deps, did, row)
}

export const RETRY_AFTER_MS = 15 * 60_000

/**
 * One scheduled step for an account, called by the indexer job through the tick route. It re-reads the row and
 * does only what is due now, so a repeated call does nothing. A failed switch-on is marked failed and shown to the
 * user. A failed switch-off keeps the state and tries again later, because the away image must not stay.
 */
export async function tickAway(deps: FlowDeps, did: string): Promise<'on' | 'off' | 'none' | 'failed'> {
  const row = await deps.store.get(did)
  const now = deps.now()
  if (row.awayRetryAt && row.awayRetryAt > now) return 'none'
  if (row.awayState === 'scheduled' && row.awayStartAt && row.awayStartAt <= now) {
    // A window that has already ended entirely is dropped without ever switching on.
    if (row.awayEndAt && row.awayEndAt <= now) {
      await deps.store.patch(did, { awayState: 'off', awayStartAt: null, awayEndAt: null, awayStartOn: null, awayEndOn: null, awayTimezone: null })
      return 'none'
    }
    try {
      const r = await switchOn(deps, did, row)
      if (r.ok) return 'on'
      await deps.store.patch(did, { awayState: 'failed', awayError: r.error })
    } catch {
      await deps.store.patch(did, { awayState: 'failed', awayError: 'Out-of-office could not be switched on. Save the dates again to retry.' })
    }
    return 'failed'
  }
  if (row.awayState === 'active' && row.awayEndAt && row.awayEndAt <= now) {
    try {
      await switchOff(deps, did, row)
      return 'off'
    } catch {
      await deps.store.patch(did, { awayError: 'Your previous image could not be restored yet. Trying again soon.', awayRetryAt: new Date(now.getTime() + RETRY_AFTER_MS) })
      return 'failed'
    }
  }
  return 'none'
}

