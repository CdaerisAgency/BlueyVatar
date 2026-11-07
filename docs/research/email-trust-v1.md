# Can the service trust emailConfirmed from a PDS? (v1)

Decision memo for issue #57 (spec section 13 item 1). Sources are primary only, fetched November 7, 2026. "No published answer" means I found no primary source that states it. No application code is changed by this memo.

## Recommendation

Keep the hybrid the code already implements, and ship it with an empty trusted list. Every link uses the mailed code until the owner adds a host to the list. The repo owner (CdaerisAgency maintainers) maintains the list in one repo file, and a host is added or removed by a pull request that the owner approves (process below). The list can stay empty at launch at no cost to safety; it only removes one step for users on hosts we choose to vouch for.

## Facts

| # | Fact | Source |
| --- | --- | --- |
| 1 | `com.atproto.server.getSession` can return optional `email` (string), `emailConfirmed` (boolean) and `emailAuthFactor` (boolean). All three are optional. | [lexicon getSession.json](https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/com/atproto/server/getSession.json) |
| 2 | On the reference PDS, `email` is the stored account email and `emailConfirmed` is `!!user.emailConfirmedAt`, so it is true only when a confirmation timestamp exists. | [getSession.ts, @atproto/pds 0.4.218](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/api/com/atproto/server/getSession.ts) |
| 3 | When the PDS fronts an entryway (`ctx.entrywayClient` set), getSession returns the entryway's response body, so the values come from the entryway. | same file |
| 4 | For OAuth credentials, the PDS removes `email`, `emailAuthFactor` and `emailConfirmed` unless the token allows `account:email` read. | same file |
| 5 | The timestamp is set only by `confirmEmail`, after a `confirm_email` token is verified and consumed. Changing the email through `updateEmail` sets `emailConfirmedAt` back to null. | [account-manager.ts](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/account-manager/account-manager.ts), [helpers/account.ts](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/account-manager/helpers/account.ts) |
| 6 | `registerAccount` inserts did, email and password hash and passes no confirmation timestamp. Whether the column default is null is not shown in the files I read. | helpers/account.ts |
| 7 | The `confirmEmail` handler contains no operator bypass flag. On the entryway path it forwards the call and validation is the entryway's job. | [confirmEmail.ts](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/api/com/atproto/server/confirmEmail.ts) |
| 8 | The admin `updateAccountEmail` handler passes only did and email to `updateEmail` (fact 5 then applies on the local path). | [updateAccountEmail.ts](https://cdn.jsdelivr.net/npm/@atproto/pds@0.4.218/src/api/com/atproto/admin/updateAccountEmail.ts) |
| 9 | `account:email` is an account-type scope that cannot be placed in a permission set, and a user can decline it while granting other scopes. The guide says nothing about trusting the returned email or `emailConfirmed`. | [atproto permission requests guide](https://atproto.com/guides/permission-requests) |
| 10 | The XRPC spec mentions registered email only as a login identifier and says nothing about hosts verifying it. | [atproto XRPC spec](https://atproto.com/specs/xrpc) |

Answers to the open questions:

- **Can a self-hosted PDS return any address?** The lexicon defines `email` as a plain optional string with no verification guarantee (fact 1). The reference source stores whatever address the account holds (fact 2). Anyone who runs their own PDS controls its database and code, so what it reports is the operator's claim. That last sentence is my inference from how self-hosting works, not a published statement.
- **Is `emailConfirmed` attestable to a third party?** No published answer. Nothing I found defines `emailConfirmed` as a signed or verifiable statement. It is a boolean in a JSON response from a host the user chose.
- **How do non-Bluesky hosts verify email?** No published answer. The reference PDS offers the token flow (fact 5). Whether another host runs it, skips it, or requires it at sign-up is undocumented.
- **Does Bluesky publish a policy on email confirmation for third-party apps?** No published answer. I found no Bluesky doc or blog post on the topic; the blog index lists only unrelated verification posts.
- **Which hostname will the token audience show for Bluesky-hosted accounts (entryway versus shard host)?** No published answer. It needs a test with a real account before any Bluesky host is listed.

## What the code does today

- Spec section 6 step 3: link directly only when the email is confirmed and the PDS host is on a trusted list. Otherwise mail a one-time code. A trusted host never takes a hash linked to a different account.
- `apps/web/lib/link.ts` `linkFromSession` calls getSession, reads `email` and `emailConfirmed`, takes the host from the token audience (`session.getTokenInfo`), and calls `linkMethod`.
- `apps/web/lib/pds.ts` `linkMethod` returns `trusted_pds` only when `emailConfirmed === true` and the host is in the list. `parseTrustedHosts` splits the `TRUSTED_PDS_HOSTS` environment variable on commas and lowercases. Matching is exact on hostname, with no wildcards.
- If the method is `trusted_pds` and the hash is not owned by another account, the link is created with no code. If another account owns the hash, it falls through to `sendCode`.
- Default today: `.env.example` sets `TRUSTED_PDS_HOSTS=` (empty), so every link uses the mailed code. `docs/deploy.md` says the web deploy waits on this value.
- The list lives in deployment configuration, not in the repo, so a change has no review trail.

## Options

| Option | How it works | Risk | Cost |
| --- | --- | --- | --- |
| A. Trusted host list in repo config | Direct link for confirmed email on a listed host, code otherwise | A listed host that is later compromised or turns lax can attach any address to its users. Bounded by the rule that a trusted host cannot take a hash owned by another account | One reviewed file and a PR process |
| B. Always mailed code | Remove the trusted path | None from host claims, since proof of inbox control comes from our own mail | One extra step for every user; no list to maintain |
| C. Hybrid (current code), empty list at launch | B for everyone until hosts are added to A | Same as B at launch, same as A per listed host | Already built |

## Recommended default and who maintains the list

Default: option C with an empty list. Hosts not on the list always get the mailed code.

Who maintains it: the repo owner. Changes land only through a pull request that the owner merges.

Adding a host (all must hold):
1. The host operator or a user asks in an issue, naming the exact hostname that appears in the token audience.
2. The host publishes a statement that it requires email confirmation before an account can use the `account:email` scope, or the owner confirms this by creating a test account.
3. The owner checks that the hostname seen at link time equals the hostname in the list (see the open Bluesky entryway question above).
4. The pull request adds one entry with a reason and the date checked.

Removing a host: any maintainer can open a pull request that removes it, and it merges on the owner's approval. Removal applies when the host stops requiring confirmation, reports abuse, or the operator asks. Links already made stay valid, because the mapping records `trusted_pds` as its method and the owner can re-verify them by code if needed.

## Exact config shape if a list is kept

A JSON file in the repo, `config/trusted-pds-hosts.json`, read at build or start, replacing the comma string:

```json
{
  "version": 1,
  "hosts": [
    {
      "host": "pds.example.com",
      "reason": "Requires confirmed email before account use; verified with a test account",
      "added": "2026-11-07",
      "addedBy": "owner"
    }
  ]
}
```

Rules: `host` is a lowercase hostname with no scheme, port, path or wildcard; matching stays exact, as in `isTrustedPds`. The initial file ships with `"hosts": []`. The `TRUSTED_PDS_HOSTS` environment variable can remain as an override for self-hosters (see `docs/self-hosting-v1.md`), and when set it replaces the file.

## Decision needed from the owner

Approve option C with an empty list, and confirm the PR-based add and remove process. A follow-up issue can move the list from the environment variable to the file above.
