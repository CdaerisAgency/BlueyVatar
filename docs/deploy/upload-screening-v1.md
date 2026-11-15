# Upload screening and atproto labels

Issue #207. Research: `docs/research/moderation-research-v1.md`. NCMEC reporting is on hold until counsel confirms, so nothing here submits a report.

### Environment variables

| Variable | App | Meaning |
| --- | --- | --- |
| `PHOTODNA_ENDPOINT` | web | Full URL of the PhotoDNA Match operation, from the API Management Portal after approval. |
| `PHOTODNA_KEY` | web | Subscription key. Screening is off unless both are set. |
| `SCAN_FAIL_CLOSED` | web | `1` or `true` also blocks uploads when the service is down. Default off. |
| `LABELER_DIDS` | indexer | Comma separated labeler DIDs to follow. Empty means label enforcement is off. |

Matches are always refused. A scanner outage lets the upload through and logs a warning (`upload screening unavailable`), unless `SCAN_FAIL_CLOSED` is set. Pick fail closed if counsel prefers that; the cost is that uploads stop whenever the service is down. The PhotoDNA request and response shapes in `packages/core/src/scanner.ts` are marked unverified: they sit behind the onboarding portal, so compare them with the portal schema once approved.

### Apply for PhotoDNA Cloud Service (owner)

1. Read the terms: <https://www.microsoft.com/en-us/photodna/termsofuse>. Access is for qualified organizations, is vetted by a third party, and is at Microsoft's discretion.
2. Apply from <https://www.microsoft.com/en-us/photodna/cloudservice> (contact page linked from <https://www.microsoft.com/en-us/PhotoDNA/Documentation>).
3. After approval, sign in to the API Management Portal (<https://developer.microsoftmoderator.com/apis>), copy the Match endpoint URL and your subscription key.
4. Set the secrets: `fly secrets set PHOTODNA_ENDPOINT=... PHOTODNA_KEY=... --app blueyvatar-web`. Check that a test upload still works.

### Enable the Cloudflare CSAM Scanning Tool (owner, no code)

In the Cloudflare dashboard: Caching, Configuration, CSAM Scanning Tool, Configure. Add a verified notification email. It scans content served through the cache after first serve, so it backs up the upload check and does not replace it. Docs: <https://developers.cloudflare.com/cache/reference/csam-scanning/>. It sends a daily email and blocks matched URLs; filing reports remains the operator's job.

### Labels

Find a labeler DID from its own profile or its published DID document (a `did:plc` or `did:web` with an `#atproto_labeler` service entry). This repo deliberately does not hardcode one: Bluesky's moderation labeler DID has not been confirmed from an official Bluesky page. Confirm it from Bluesky's own documentation or account before adding it to `LABELER_DIDS`.

The indexer connects to each labeler's `com.atproto.label.subscribeLabels` endpoint, resumes from the cursor stored in `label_cursors`, and stores only the values it enforces in `moderation_labels`. Label signatures are not verified (see `apps/indexer/src/labels.ts`).

- `!takedown`, `!suspend`, `!hide` on an account or record: delivery stops serving it (avatar, gallery, and blob routes), and cached copies are purged.
- `porn`, `sexual`, `nudity`, `graphic-media`: the effective rating rises (x, r, r, pg) and never falls, so rating filters apply.
- A new enforced label adds one open item to `reports` (origin `label`), so it shows in the admin page with the other reports. A negation removes the stored label; the review item is left for an admin to dismiss.

### Upload scan events and the daily digest

`upload_scan_events` holds one row per match or outage: account, service, outcome, flags, time. It holds no image and no hash, and no page reads it. `scanCounts()` in `apps/web/lib/upload-screen.ts` returns the same counts; the indexer's daily moderation digest (see Web admin page) now reads the table directly. The metric `web_upload_screen_total{outcome}` counts the same events.
