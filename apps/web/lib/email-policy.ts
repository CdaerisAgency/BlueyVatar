/** Email ownership rules (spec section 6, issues #63 and #93). Pure; stores gather the facts. */
export const MAX_LINKED_EMAILS = 10
export const HOLD_DAYS = 30
export const HOLD_MS = HOLD_DAYS * 24 * 60 * 60 * 1000

export type LinkFacts = {
  /** Who holds the hash today: nobody, this account, or another account. */
  owner: 'none' | 'self' | 'other'
  /** End of an active hold held by a different DID. Ignored while the hash is still linked. */
  heldByOtherUntil?: number
  /** Emails this account has linked now. */
  count: number
}

export type LinkDecision =
  | { ok: true; moved: boolean }
  | { ok: false; reason: 'cap' | 'held'; until?: number }

export function decideLink(f: LinkFacts): LinkDecision {
  // Re-verifying an email the account already has never counts against the cap.
  if (f.owner === 'self') return { ok: true, moved: false }
  // Still linked elsewhere: a verified code moves it (newest verification wins). The hold applies only after release.
  if (f.owner === 'other') return f.count >= MAX_LINKED_EMAILS ? { ok: false, reason: 'cap' } : { ok: true, moved: true }
  if (f.heldByOtherUntil !== undefined) return { ok: false, reason: 'held', until: f.heldByOtherUntil }
  if (f.count >= MAX_LINKED_EMAILS) return { ok: false, reason: 'cap' }
  return { ok: true, moved: false }
}

export function linkErrorMessage(d: Extract<LinkDecision, { ok: false }>): string {
  if (d.reason === 'cap') return `You can link at most ${MAX_LINKED_EMAILS} emails. Unlink one before adding another.`
  const when = d.until ? ` until ${new Date(d.until).toISOString().slice(0, 10)}` : ''
  return `This address was released recently and cannot be linked to a different account${when}.`
}

export const movedNotice = (publicUrl: string) => ({
  subject: 'Your email was linked to a different blueyvatar account',
  text:
    `This address was linked to a blueyvatar account. Someone just proved they control it with a one-time code, ` +
    `so the link was moved to their account (the newest verification wins).\n\n` +
    `If that was you, nothing more is needed. If it was not, sign in at ${publicUrl}/account with your account and ` +
    `add this address again with a one-time code to move it back.`,
})
