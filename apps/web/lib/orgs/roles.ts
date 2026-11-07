/** Organization roles (issue #180). Owners manage billing and membership; every member manages keys. */
export const ROLES = ['owner', 'member'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (v: unknown): v is Role => v === 'owner' || v === 'member'

export const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]{1,200}$/

export const canManageKeys = (role: Role | null): boolean => role === 'owner' || role === 'member'
export const canManageMembership = (role: Role | null): boolean => role === 'owner'
export const canManageBilling = (role: Role | null): boolean => role === 'owner'

export interface Member {
  did: string
  role: Role
}

export type Change = { kind: 'remove'; did: string } | { kind: 'role'; did: string; role: Role }

/**
 * Checks a membership change against the rules that hold for every organization: the target is a member, an organization
 * always keeps at least one owner, and the billing owner (who holds the Stripe customer) stays an owner.
 * Returns an error message, or null when the change is allowed.
 */
export function checkChange(members: readonly Member[], billingDid: string, change: Change): string | null {
  const target = members.find((m) => m.did === change.did)
  if (!target) return 'That account is not a member of this organization.'
  const losesOwner = target.role === 'owner' && (change.kind === 'remove' || change.role !== 'owner')
  if (!losesOwner) return null
  if (members.filter((m) => m.role === 'owner').length <= 1) return 'An organization must keep at least one owner.'
  if (target.did === billingDid) return 'The billing owner holds the Stripe customer and must stay an owner.'
  return null
}
