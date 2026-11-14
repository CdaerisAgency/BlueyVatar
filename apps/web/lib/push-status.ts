import { CONSENT_WINDOW_MS, type PushState } from './push-store'

/**
 * What one app's row on the integrations page shows. Pure, so the rules are tested without a page.
 *
 *  off               box unticked
 *  on                box ticked and the permission is held
 *  needs_permission  box ticked, but the permission is gone (for example after a later sign-in): pushes cannot happen
 *  finish            the user came back from the permission screen with the permission: one step left
 *  declined          the user came back from the permission screen without it
 */
export type RowStatus = 'off' | 'on' | 'needs_permission' | 'finish' | 'declined'

export const consentOpen = (state: Pick<PushState, 'consentStartedAt'>, now: number = Date.now()): boolean =>
  state.consentStartedAt !== null && now - state.consentStartedAt.getTime() < CONSENT_WINDOW_MS

export function rowStatus(state: Pick<PushState, 'enabled' | 'consentStartedAt'>, permitted: boolean, now: number = Date.now()): RowStatus {
  if (state.enabled) return permitted ? 'on' : 'needs_permission'
  if (consentOpen(state, now)) return permitted ? 'finish' : 'declined'
  return 'off'
}
