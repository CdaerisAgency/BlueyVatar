import { SESSION_EXPIRED_MESSAGE } from './form-state'
import { IMPORT_FIELDS, type ImportField, type ImportState, type ImportValues } from './import-limits'
import { parseRLabel, parseRating, validateAlt, validateNewImage, type NewImageFields } from './records'

export { IMPORT_FIELDS, type ImportField, type ImportState, type ImportValues }

export function readImportForm(form: FormData): ImportValues {
  return {
    alt: String(form.get('alt') ?? ''),
    rating: String(form.get('rating') ?? ''),
    rLabel: String(form.get('rLabel') ?? ''),
    isDefault: form.get('isDefault') === 'on',
  }
}

export type ImportDeps = {
  limited: (did: string) => Promise<string | null>
  /** Fetches, screens, and saves the image. Returns a note for the done message, or an error to show. Throws on unexpected failures. */
  run: (did: string, fields: NewImageFields) => Promise<{ ok: true; note: string | null } | { ok: false; error: string }>
  report: (err: unknown) => void
  messageFor: (err: unknown) => string
}

/** Checks each field on its own so every problem shows at once. */
export function importFieldErrors(v: ImportValues): Partial<Record<ImportField, string>> {
  const errors: Partial<Record<ImportField, string>> = {}
  const alt = validateAlt(v.alt)
  if (!alt.ok) errors.alt = alt.error
  const rating = parseRating(v.rating)
  if (!rating.ok) errors.rating = 'Choose a rating for this image.'
  else if (rating.value === 'r') {
    const l = parseRLabel(v.rLabel)
    if (!l.ok) errors.rLabel = l.error
  }
  return errors
}

/** Every failure returns the typed values. Success returns `done`, and the action redirects with it. */
export async function runImport(did: string | null, form: FormData, deps: ImportDeps): Promise<ImportState> {
  const values = readImportForm(form)
  if (!did) return { values, sessionExpired: true, formError: SESSION_EXPIRED_MESSAGE }
  const errors = importFieldErrors(values)
  if (Object.keys(errors).length) return { values, errors }
  const fields = validateNewImage(values)
  if (!fields.ok) return { values, formError: fields.error }
  const wait = await deps.limited(did)
  if (wait) return { values, formError: wait }
  try {
    const r = await deps.run(did, fields.value)
    if (!r.ok) return { values, formError: r.error }
    return { done: r.note ? `Image imported. ${r.note}` : 'Image imported.' }
  } catch (err) {
    deps.report(err)
    return { values, formError: deps.messageFor(err) }
  }
}
