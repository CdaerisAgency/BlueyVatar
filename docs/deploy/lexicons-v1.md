# Publish the lexicons

Covers issue #54. Everything below is scripted in `tools/lexicon`; nothing has been published yet, and name clearance is closed (issue #60). The steps need a DNS zone for `blueyvatar.com` and an atproto account, so they run at deploy time. Primary sources: the [Lexicon spec](https://atproto.com/specs/lexicon) (section "Lexicon Publication and Resolution"), the [Permissions spec](https://atproto.com/specs/permission), the [permission sets guide](https://atproto.com/guides/permission-sets), and the [publishing guide](https://atproto.com/guides/publishing-lexicons).

### What gets published

| NSID | Kind | Record key in `com.atproto.lexicon.schema` |
| --- | --- | --- |
| `com.blueyvatar.image` | record | `com.blueyvatar.image` |
| `com.blueyvatar.profile` | record | `com.blueyvatar.profile` |
| `com.blueyvatar.claim` | record | `com.blueyvatar.claim` |
| `com.blueyvatar.attestation` | record (written to the service repo) | `com.blueyvatar.attestation` |
| `com.blueyvatar.authFull` | permission set, write access to image, profile, and claim | `com.blueyvatar.authFull` |

The files under `lexicons/vendor` belong to other authorities (`com.atproto`, `app.bsky`) and are never published from here.

The spec resolves an NSID through its authority, which is every segment except the last, reversed. All five NSIDs share the authority `com.blueyvatar`, so one DNS record covers them: `_lexicon.blueyvatar.com`. The spec says each authority needs its own TXT record and resolvers do not search parent or child names. Adding an NSID under a new group later, such as `com.blueyvatar.sub.thing`, needs `_lexicon.sub.blueyvatar.com`. The dry run prints one line per authority.

### Steps

1. **Pick the publishing account.** Its DID goes into the TXT record, so changing it later means a DNS change and a wait for caches. It can be the service repo account (`SERVICE_REPO_DID`) or a dedicated one. This is an owner decision. Create an app password for it in the account's settings.
2. **Validate and dry run** (no network, no credentials):

   ```sh
   pnpm lexicons:validate
   pnpm lexicons:dry-run
   ```

   The validator runs the reference parser from `@atproto/lexicon`, then checks reference resolution, union targets, record key types, blob `accept` patterns, and the permission-set rules (only `repo` and `rpc`, no wildcards, collections inside the set's namespace and present in this repo, non-empty `collection` arrays, valid `action` values). The dry run also checks each planned record (`com.atproto.lexicon.schema` shape, record key equal to the NSID, `com.blueyvatar.authFull` included), then prints the exact `putRecord` body for each schema and the TXT line, with a placeholder for the DID unless `LEXICON_PUBLISH_DID` is set. The same checks run before a real publish.
3. **Publish the records.** Export the variables from Infisical in your shell. Never commit them or put them in `.env.example` with values.

   ```sh
   export LEXICON_PUBLISH_IDENTIFIER=...        # handle or DID
   export LEXICON_PUBLISH_APP_PASSWORD=...      # app password
   export LEXICON_PUBLISH_SERVICE=https://...   # the account's PDS
   pnpm lexicons:publish
   ```

   The script logs in with `com.atproto.server.createSession`, writes each schema with `com.atproto.repo.putRecord` (collection `com.atproto.lexicon.schema`, record key equal to the NSID) to the PDS named in the DID document, and skips records that already match. It prints `created`, `updated`, or `unchanged` per schema, then the exact TXT record. Rerunning is safe.
4. **Create the DNS record** in the `blueyvatar.com` zone: type `TXT`, name `_lexicon` (that is `_lexicon.blueyvatar.com`), value `did=did:plc:...` exactly as printed. The `did=` prefix is part of the value. Use DNS only, since TXT records are not proxied.
5. **Verify** once DNS has propagated:

   ```sh
   LEXICON_PUBLISH_DID=did:plc:... LEXICON_PUBLISH_PDS_URL=https://... pnpm lexicons:verify
   ```

   It checks that the TXT value names the DID and that the PDS serves records identical to the local files. Without `LEXICON_PUBLISH_PDS_URL` it checks DNS only. It exits non-zero on any failure.
6. **Switch the OAuth client.** Only after step 5 passes, set `OAUTH_USE_PERMISSION_SET=true` on the web app (`fly secrets set --app blueyvatar-web OAUTH_USE_PERMISSION_SET=true`; staging first). The client metadata and the sign-in request then ask for `atproto include:com.blueyvatar.authFull blob:image/*` (plus `account:email` while linking an email) in place of the three `repo:` scopes. The flag is read per request, so a restart is enough and no rebuild is needed. Remove the secret to roll back. Test a sign-in on staging before production.
7. **Close issue #54** once sign-in works with the `include:` scope.

### Behavior to know

- The authorization server (the user's PDS) resolves the set when a session starts. If it cannot resolve the set and has no cached copy, the authorization request fails. That is why the flag defaults to off.
- Authorization servers cache sets. The spec recommends 24 hours as the upper bound before a refresh attempt, and a refresh updates the permissions of an existing session when its tokens are renewed.
- Editing the set later (for example adding a record type) is a republish: run step 3 again. Lexicon evolution rules apply: new fields must be optional, and types, required fields, and length limits cannot change after third parties adopt a schema.
- `blob:image/*` and `account:email` cannot go inside a permission set, so they stay in the scope string.
- The attestation schema is published for readers, but users never grant write access to it, because attestations live in the service repo.

### Not answered by the primary sources

- What a resolver does when one `_lexicon` name has more than one `did=` value. The spec does not say. `lexicons:verify` reports it as a failure, and the TXT record should hold a single value.
- Which authorization servers other than the Bluesky PDS implementation support `include:` scopes today. The Permissions spec says authorization servers are expected to resolve sets. No list of supporting servers was found, so confirm with a staging sign-in on the PDS hosts you care about.
- Which login server to use for an app password. This depends on where the account is hosted, so the script requires `LEXICON_PUBLISH_SERVICE` and has no default.
- Whether a PDS validates `com.atproto.lexicon.schema` records on write. The Lexicon spec describes PDS validation as optimistic when a lexicon is unknown, and the script relies on that default.
- The script was tested against stubbed HTTP and DNS only. No live account was available, so the first real publish is its first live run.
