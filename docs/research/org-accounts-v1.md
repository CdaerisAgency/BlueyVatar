# Organization accounts, design memo v1

Issue #180. Spec section 10.3 says a license owner is "a DID or an organization account", and section 11.1 sells Business ($49 per month, 25 keys) to companies. This memo records how organizations work. Owner decisions: build now, and add members by atproto DID only, with no email invites.

## Identity

atproto has no organization account type, so an organization is a service-side record: `organizations (org_id, name, created_by, created_at)`. Its people are DIDs in `organization_members (org_id, did, role, added_by, added_at)`. An organization has exactly one license, a row in `licenses` with `org_id` set (unique per organization).

## Roles

| Role | Keys | Membership | Billing |
| --- | --- | --- | --- |
| owner | create, rotate, revoke, set domains | add, remove, change roles | start Checkout, open the portal |
| member | create, rotate, revoke, set domains | leave only | none |

The issue listed an admin role as well. Two roles (owner and member) cover the stated policy, because the only line drawn is "members manage keys, owners manage billing and membership". An admin role can be added later with a CHECK change and no data migration.

Rules, enforced in one transaction under a per-organization advisory lock:

- An organization always keeps at least one owner. Removing or demoting the last owner is refused.
- The billing owner stays an owner (see Billing), so they cannot be removed or demoted by anyone.
- Any member can leave, subject to the two rules above.

## Adding members

An owner types a DID (`did:plc:` or `did:web:`). The member is added at once with no acceptance step, because there is no invitee address to mail and no pending state to store. Handles are not accepted: resolving a handle to a DID is a network call whose result can change, and the owner decision limits input to DIDs. The only identity data stored for a member is the DID.

## Licenses and billing

- The organization license has `owner` set to the billing owner, the DID that created the organization. That DID holds the Stripe customer (`billing_customers` stays one row per DID).
- Checkout and the portal for an organization run as the billing owner's customer, started by any owner. Only Business is offered to organizations.
- Checkout stamps `license_id` in the subscription metadata. The webhook uses it to attach the subscription to the organization license when the DID owns that license, and falls back to the DID's personal license otherwise. Tier resolution (`resolveLicenseBilling`, grace period, past due) is unchanged and runs per license.
- One developer subscription per license, so a person can hold a personal Pro and an organization Business at once. Plus is unchanged and stays per DID.
- Personal-license lookups now filter `org_id IS NULL` so an organization license is never mistaken for a person's own.
- Payment notices go to the billing owner (the license owner), as they do today.

## Keys

Keys belong to the license, so an organization's keys belong to the organization. The keys page takes `?org=<id>`. Members of the organization may manage them, with the same tier limits and rate limits as personal keys. Key revocation notices go to the billing owner.

## Audit

`organization_audit` is insert-only and covers `org_created`, `member_added`, `member_removed`, `member_left`, `role_changed`, `key_created`, `key_rotated`, `key_revoked`, and `key_domains_changed`. It follows the `admin_actions` shape (actor, action, target, detail, time) but is separate, because `admin_actions` records operator moderation and has a different retention story. Owners read it on the organization page.

## Data on member removal

Keys belong to the organization and keep working when a member leaves. Nothing the member created is deleted. The removed DID stays in the audit log as a record of what happened, until that account deletes its data.

## Export and deletion (#140 and #166)

- Export includes the person's memberships (organization, role, date) and audit rows where they are the actor or target, plus `org_id` on any license they own.
- Account deletion handles organizations before the license delete, inside the deletion transaction:
  - A member who is not the billing owner leaves. Their DID is cleared from `organization_audit.actor`, `organization_audit.target_did`, and `organization_members.added_by`, and a `member_left` row records "account deleted" with no DID.
  - A billing owner who is the only member: the organization is deleted, which cascades to its license, keys, usage counters, usage alerts, and audit rows. The Stripe subscription is canceled with the account's other subscriptions, and billing rows are kept 7 years with `deleted_at`, as before.
  - A billing owner with other members is refused before anything is removed or canceled, with a message to remove the other members first. Transferring billing ownership would need a new Stripe customer and is out of scope for v1.

## Out of scope

Billing ownership transfer, an admin role, handle lookup, organization rename and delete screens, and SSO. Enterprise organizations are set up by contract and use the same tables.
