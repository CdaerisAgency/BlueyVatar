/**
 * First-run checklist for /account (issue #152). Every step except "view your public profile" is computed
 * from data the account already has; the view step is remembered in a cookie because nothing else records it.
 */
export type ChecklistFacts = {
  emailLinked: boolean
  /** Avatar images (not gallery), each saved with a rating. */
  avatarCount: number
  profile: { jobTitle?: string; company?: string; location?: string; pronouns?: string; pronunciation?: string; timezone?: string; interests?: string[] } | null
  /** A visibility_rules row exists, so the owner has saved a choice. */
  visibilitySaved: boolean
  viewedPublicProfile: boolean
}

export type ChecklistStep = { id: 'email' | 'avatar' | 'profile' | 'visibility' | 'view'; title: string; hint: string; href: string; done: boolean }

export const PROFILE_FIELDS = ['jobTitle', 'company', 'location', 'pronouns', 'pronunciation', 'timezone'] as const

export function profileFilled(p: ChecklistFacts['profile']): boolean {
  if (!p) return false
  return PROFILE_FIELDS.some((k) => typeof p[k] === 'string' && p[k]!.trim() !== '') || (p.interests ?? []).some((i) => i.trim() !== '')
}

export function checklist(f: ChecklistFacts): { steps: ChecklistStep[]; done: number; total: number; complete: boolean; next: ChecklistStep | null } {
  const steps: ChecklistStep[] = [
    { id: 'email', title: 'Link an email', hint: 'Your avatar appears wherever that address is used.', href: '/account#link-email', done: f.emailLinked },
    { id: 'avatar', title: 'Upload an avatar and choose a rating', hint: 'Pick G, PG, R, or X so apps know where it fits.', href: '/account/avatars', done: f.avatarCount > 0 },
    { id: 'profile', title: 'Fill in your profile', hint: 'Add a job title, location, or anything else you want to share.', href: '/account/profile', done: profileFilled(f.profile) },
    { id: 'visibility', title: 'Set your visibility', hint: 'Keep everything public or restrict who can fetch it.', href: '/account/visibility', done: f.visibilitySaved },
    { id: 'view', title: 'View your public profile', hint: 'See what other people see.', href: '/account/checklist/view', done: f.viewedPublicProfile },
  ]
  const done = steps.filter((s) => s.done).length
  return { steps, done, total: steps.length, complete: done === steps.length, next: steps.find((s) => !s.done) ?? null }
}

/** Incomplete: always shown. Complete: hidden unless the owner asked to see it again. */
export const showChecklist = (complete: boolean, showAgain: boolean): boolean => !complete || showAgain

export const CHECKLIST_COOKIE = 'bv_checklist'
export type ChecklistPrefs = { showAgain: boolean; viewed: boolean }

export function parsePrefs(raw: string | undefined): ChecklistPrefs {
  const set = new Set((raw ?? '').split(','))
  return { showAgain: set.has('show'), viewed: set.has('viewed') }
}

export const serializePrefs = (p: ChecklistPrefs): string => [p.showAgain ? 'show' : '', p.viewed ? 'viewed' : ''].filter(Boolean).join(',')
