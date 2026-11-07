# blueyvatar moderation research (v1)

Date: 2026-11-07. Research only, no code. Not legal advice; counsel must confirm everything in section 4. "Not documented" means I could not find it in the official source fetched. Several pages (docs.bsky.app moderation guide, Hive/Thorn pricing, TSPA chapter text, Tech Coalition resilience guidebook, HCOMP blur paper) could not be read directly; those gaps are marked.

## Summary for the owner

1. Cloudflare's CSAM Scanning Tool is free but only scans content served through the Cloudflare cache. It cannot screen at upload time, has no documented on-demand hash API, and does not report to NCMEC for you. It is a backstop, not the upload screen the owner wants.
2. Upload-time screening needs a hash-matching API: PhotoDNA Cloud Service (free, vetted), Thorn Safer / Safer Match (via Thorn, Hive, or AWS Marketplace, pricing not public), Google Content Safety API (free, application required, classifier for new content), or Hive (commercial, pricing not public). All of these still leave the reporting duty with you.
3. atproto labels are applied after content exists, so they cannot vet a brand-new image. Bluesky says it hash-matches uploads and diverts matches, but that result is not exposed as a label you can query.
4. Naming a third-party scanner does not move legal responsibility. 18 U.S.C. 2258A duties attach to the provider with "actual knowledge", regardless of scanner. There is also no statutory duty to scan.
5. For the admin tool, the strongest published models are Ozone (open source, Bluesky) and ROOST Coop (open source, has blur, grayscale, NCMEC queue). Checklist in section 5.

---

## 1. Cloudflare CSAM Scanning Tool

**How it works.** Cache-based, not an API.
- Docs: Cloudflare will "compare content served for your website through the Cloudflare cache to known lists of CSAM". https://developers.cloudflare.com/cache/reference/csam-scanning/
- Sept 2025 blog: "Our tool scans your cached content for potential CSAM, creating a fuzzy hash of each image." https://blog.cloudflare.com/a-simpler-path-to-a-safer-internet-an-update-to-our-csam-scanning-tool/
- Launch blog: uses fuzzy hashing with a per-customer match threshold; "The software can only scan images at rest in memory", so streaming images are not covered. https://blog.cloudflare.com/the-csam-scanning-tool

**On a match.**
- Docs: "If possible, a block is placed to prevent further serving of the matched content." If the block fails, the email says so. Notification is a once-daily email covering the past 24 hours.
- Launch blog: blocked content returns HTTP 451.
- Sept 2025 blog: "Cloudflare blocks the URL to any identified matches and notifies you so that you may take further action."
- NCMEC: you file. Blog: "Site operators are still expected to continue to file their own reports with NCMEC or their regional equivalent." Docs: "You likely have an obligation to report apparent CSAM to the appropriate authorities."

**Requirements and cost.**
- Free: "at no cost for all customers regardless of their plan level" (launch blog); "our free child safety tooling for all customers" (2025 blog).
- NCMEC credentials: 2025 blog says "The tool no longer requires website operators to create and provide their own unique NCMEC credentials." The docs page I fetched does not mention credentials (a search summary claimed it did; I could not confirm). Treat as: not required now, verify in the dashboard.
- Setup: Caching > Configuration > CSAM Scanning Tool > Configure; a verified notification email is required. Use is limited to preventing the spread of CSAM under the Service-Specific Terms.
- Block removal: Admin, Super Admin, or Trust & Safety roles can request review.

**Upload time?** No. It acts on content served through the cache. Not documented as usable on an image before first serve. Detection could only occur after someone requests the image through your Cloudflare zone, and only if the response is cached.

**On-demand hash-check API?** Not documented. Neither the docs page nor either blog describes one.

## 2. Upload-time hash matching alternatives

| Service | Eligibility | Cost | Upload-time API | Reporting duty tied to use |
|---|---|---|---|---|
| Microsoft PhotoDNA Cloud Service | "a qualified organization subject to approval by third-party vetting service"; access "subject to Microsoft's sole discretion" (https://www.microsoft.com/en-us/photodna/cloudservice, https://www.microsoft.com/en-us/photodna/termsofuse) | "free for qualified customers"; search results indicated limited free transactions per month, not confirmed on the primary page | Yes, "a simple REST API call"; images hashed, "never retained by Microsoft" | Terms: laws may require reporting to NCMEC; Microsoft may send NCMEC aggregate match counts naming you; "Such reports do not relieve you of any legal requirements." No SLA or support; internal use only; 30-day terms |
| Thorn Safer / Safer Match / Safer Essential | No formal criteria published. Safer Match targets "content-hosting platforms" (https://www.thorn.org/blog/safer-match/) | Not published; AWS Marketplace listing says custom pricing by contract | Yes, "a hashing and matching solution offered via an API"; 57M+ hashes per Hive's page | Whether NCMEC filing is bundled for Safer Match: not documented. Original Safer was built to "detect, review and report" |
| Google Content Safety API (and CSAI Match for video) | "Industry and civil society third parties"; "subject to approval"; apply via interest form (https://protectingchildren.google/tools-for-partners/) | "free of charge" for qualifying partners | Classifies not-yet-seen images and gives a review-priority value; synchronous behavior not confirmed on the page. It prioritizes review, it is not a known-hash match | Partners review and report "in accordance with local laws and regulations" |
| Hive CSAM Detection | No formal criteria published (https://thehive.ai/apis/csam-detection) | Not published | Yes, "accessible with a single API call"; wraps Thorn's hash database; IWF members can add IWF hashes. Note: separate hash and classifier endpoints are being merged (https://docs.thehive.ai/reference/image-and-video-csam-matching-api) | Hive Arbiter has integrated NCMEC CyberTipline submission, so reporting tooling exists, but the legal duty remains yours |
| NCMEC Hash Sharing API | Requires NCMEC ESP registration (per ROOST docs, https://docs.roost.tools/coop/1.0/user/child-safety.html, and search results: esp.ncmec.org/registration) | Not documented | Separate credentials; a hash feed for your own matching | Registration pairs with CyberTipline API credentials |

Notes:
- Reporting itself needs NCMEC ESP registration and CyberTipline API credentials (secondary sources; confirm at NCMEC). The official NCMEC page I fetched did not cover this.
- None of these cover non-CSAM categories (porn, gore, spam). Hive and others sell separate classifiers; not researched in detail.

## 3. Bluesky / atproto labels

**How a third-party app consumes labels.** https://atproto.com/specs/label
- `com.atproto.label.subscribeLabels`: "an event stream (WebSocket) endpoint, which broadcasts new labels", backfill from `cursor=0`.
- `com.atproto.label.queryLabels`: scroll with a cursor, or filter by subject.
- "Labels need not be public. Labelers may restrict access or skip these endpoints entirely."
- Clients pick labelers with the `atproto-accept-labelers` header; services echo `atproto-content-labelers`. Up to 10 labelers per request (per the atproto API moderation docs seen in search results; docs.bsky.app page itself failed to load).
- Labeler identity: a DID document with `#atproto_label` signing key and `#atproto_labeler` service entry.
- Ozone is Bluesky's open-source labeler/moderation tool: "Ozone is built to help humans review moderation reports" (https://bsky.social/about/blog/03-12-2024-stackable-moderation).
- Bluesky's own moderation labeler DID: only seen in third-party code (`did:plc:ar7c4by46qjdydhdevvrndac`). Not verified on an official page; confirm before use.

**Label values.**
- Protocol-level: `!takedown`, `!suspend`; with the `redact` flag the service removes content instead of labeling (atproto label spec). `!warn` also used as an example there.
- Lexicon knownValues (https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/com/atproto/label/defs.json): `!hide`, `!warn`, `!no-unauthenticated`, `porn`, `sexual`, `nudity`, `graphic-media`, `bot`. No descriptions in the lexicon.
- A CSAM label value: not documented. A "spam" label value: not in the sources I could read.
- Ozone has "Divert", an infrastructure-level action "used primarily for illegal child abuse imagery" (https://github.com/bluesky-social/ozone/blob/main/docs/userguide.md).

**Latency / pre-upload check.**
- Labels attach to existing subjects (a URI or DID). Not documented as available before content exists. A brand-new image has no label, so labels cannot gate an upload. Your own hash check at upload is needed.
- Label timing is not documented in the spec. Bluesky transparency reports use "immediately" and "high priority" with no numbers.

**Does Bluesky scan blobs?**
- 2024 moderation report: Bluesky subscribes to hashes of known CSAM, and matches are "immediately removed from the site and our infrastructure without the need for a human to view the content." https://bsky.social/about/blog/01-17-2025-moderation-2024
- 2025 transparency report: Thorn's Safer supplies hash databases; matches are "immediately diverted"; 12,647 items diverted, 5,238 NCMEC reports. https://bsky.social/about/blog/01-29-2026-transparency-report-2025. It also describes automated labeling of all uploaded images through Hive.
- Not documented: whether this runs in the PDS (bsky.social) or the AppView, and whether it covers blobs on third-party or self-hosted PDSes. Do not assume a user's PDS has screened an image blueyvatar fetches.

## 4. Legal framing (counsel must confirm)

**Short answer.** Naming a scanner as "the responsible party" does not remove the service's own statutory duties. Scanner terms say the same: PhotoDNA terms state vendor reports "do not relieve you of any legal requirements"; Cloudflare says site operators "are still expected to ... file their own reports".

**US, 18 U.S.C. 2258A** (https://www.law.cornell.edu/uscode/text/18/2258A)
- Duty: report to NCMEC's CyberTipline "as soon as reasonably possible after obtaining actual knowledge" of apparent violations. Knowledge can arise from user reports or from a scanner hit, so your report intake and review process triggers it.
- Preservation: a report is treated as a request to preserve contents for 1 year (extended from 90 days by the 2024 amendment, Pub. L. 118-59, per the page); store securely and limit access.
- No scanning mandate: subsection (f) says nothing requires a provider to "affirmatively search, screen, or scan". Scanning is voluntary, but once you scan or receive reports, knowledge triggers the duty.
- Penalties for knowing and willful failure: up to $600,000 (smaller providers) or $850,000 (100M+ MAU) for a first failure; higher for repeats.
- Not researched: 2258B limited-liability protections for handling material; ask counsel what staff may view, copy, or store.

**US, DMCA 512(c)** (https://www.law.cornell.edu/uscode/text/17/512) covers copyright only, not CSAM. Conditions: no actual knowledge or red-flag awareness (or act quickly once you have it); respond "expeditiously to remove, or disable access to" material after valid notice; designate and register an agent; adopt and reasonably implement a repeat-infringer policy (512(i)). 512(m): no duty to monitor. Relevant to avatars that copy others' artwork or photos.

**EU, Digital Services Act** (https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2065; I read articles 9, 10, 16, 17, 18 and recitals; the rest of the text was not fully read)
- Art 6 hosting exemption: act expeditiously once aware (recital 22). Art 8: no general monitoring (recital 30).
- Art 14: state moderation grounds and tools in terms and conditions.
- Art 16: easy electronic notice-and-action; notices contain explanation, exact URL, submitter name and email (not required for child abuse offences), and a good-faith statement.
- Art 17: statement of reasons to affected users (contents in section 5).
- Art 18: promptly inform law enforcement of suspected offences threatening life or safety.
- Art 20 internal complaints and Art 24 transparency reports are platform obligations; micro and small enterprises are exempted from some online platform duties (Art 19). Whether blueyvatar is a "hosting service" or "online platform", and whether it qualifies as small, is for counsel.

**Open questions for counsel.** (a) Is blueyvatar a "provider" under 2258A given the image lives on the user's PDS but is cached and served by you? (b) What may staff view or retain, and the preservation setup. (c) NCMEC ESP registration. (d) DSA establishment and legal representative. (e) Terms of service and privacy wording about screening and the vendor's name. (f) Vendor contract data-processing terms.

## 5. Review portal best practices and checklist

**Source quality note.** Published, citable designs: Ozone, ROOST Coop, and DSA text. Discord and YouTube internal report-tool designs: not documented in sources I found. TSPA chapter text and the Tech Coalition resilience guidebook could not be read (TSPA page lists titles only: https://www.tspa.org/curriculum/ts-curriculum/). Blur/grayscale research is mixed: an HCOMP 2020 study (abstract via search summary) found interactive blur reduces emotional impact while static blur reduces accuracy; a later study found grayscale raised positive affect while blur lowered it; a 2026 paper reports doubt about effectiveness. Treat these as reasonable defaults, not proof.

**What the sources say**
- Ozone (https://github.com/bluesky-social/ozone/blob/main/docs/userguide.md): queues Unreviewed, Escalated, Resolved, All; toggles for muted, takendown, appealed, language; actions Acknowledge, Escalate, Label, Tag, Mute, Comment, Email, Takedown, Appeal, plus infra-level Divert; event log of all actions with acting user, filterable by type and date; subject history with report history; email templates by policy and language with variables and a block on unfilled placeholders; template name logged but full email text not saved; images "blurred ... mousing over will remove the blur". Not documented: required reason or policy, roles, priority score.
- ROOST Coop (https://docs.roost.tools/coop/1.0/user/review-console.html, .../child-safety.html): oldest job first, next job auto-loads, "Two moderators will never receive the same job"; blur by default with hover reveal and adjustable strength; grayscale option; mute videos; org wellness defaults with per-user override; per-queue action hiding; skip button; separate NCMEC queue with restricted roles, user-centric jobs aggregating a user's media, classification A1/A2/B1/B2 and incident type, then "Submit to NCMEC".
- Moderation tooling essay (https://vale.rocks/posts/moderation-tooling-design; informal, not a standards body): show category before content; adjustable blur; no audio by default; rotate exposure; show only what the case needs.
- Tech Coalition (https://technologycoalition.org/wp-content/uploads/CSAM-Identification_Reporting_R3-1.pdf): "Human review is a costly and time-consuming aspect"; the biggest cost is "the impact on the individual specialists", mitigated through technology and wellness initiatives. A related paper notes some companies avoid reviewing suspected CSAM and rely on hotlines, trusted notifiers, or law enforcement (citation found via search, text not read).
- DSA Art 17(3) statement of reasons: (a) what action and its scope and duration; (b) facts relied on, and whether from a notice or own initiative; (c) whether automated means were used; (d) legal ground and why illegal, for illegal content; (e) contractual ground for terms violations; (f) redress options. Must be "clear, easily understood, and as precise as reasonably possible".

**Checklist**

Queue design
- Separate queues: Unreviewed, Escalated, Resolved, Appealed (Ozone model); separate restricted child-safety queue (Coop model).
- Priority: severity tier first (child safety, then illegal, then policy), then age (oldest first, SLA breach next). Severity tiers with enforcement mapping also mirror Bluesky's Critical/High/Moderate/Low (https://bsky.social/about/blog/11-19-2025-moderation-updates).
- SLA timer per tier, shown on each item; CSAM path "as soon as reasonably possible".
- Deduplicate by subject (avatar blob CID or account DID), aggregating reports; lock one reviewer per job.
- Report intake requires a category so reviewers see it before the image; DSA notice fields: explanation, exact URL, reporter contact, good-faith statement.

Case view
- Subject history and prior actions on the account and on the same image hash; reporter count and report categories; reporter identity visible only to authorized roles (DSA Art 17(3)(b): notifier identity only where strictly necessary); scanner result at upload, if any.
- Show only needed data; hide unrelated personal details.

Actions
- Required reason and cited policy for every action (Ozone does not document this; add it, because Art 17 needs it).
- Core set: Acknowledge/no action, Remove avatar, Label/blur, Warn, Suspend account, Escalate, Reverse, Appeal outcome, Comment, Tag.
- Per-queue action restrictions (Coop): triage queue cannot permanently ban.
- Reversal path and appeals workflow ("Every enforcement action can be appealed", Bluesky).

Reviewer wellness
- Blur by default, hover or click to reveal, adjustable strength, grayscale toggle, no audio, keyboard shortcuts, skip, exposure rotation, per-reviewer daily cap. Cap values and efficacy are not set by any official source I read; define them with a wellness professional.
- Per-user overrides of org defaults.

Audit log
- Append-only event log of every view-to-reveal, action, comment, email, role change, with actor and timestamp (Ozone logs actions; logging reveals is my suggestion, not documented).
- Store template name, not necessarily full text (Ozone behavior), but keep what Art 17 evidence requires.

Templated notices
- Templates by policy, language, and action; variables; send blocked on unfilled placeholders (Ozone).
- Must include the Art 17(3) fields for EU users: action and duration, facts, automated-means flag, legal or contractual ground, redress.

Escalation
- CSAM path: do not display in the general queue; hash hit or report flagged as child safety goes to a restricted role (or reviewed by no one internally if counsel advises, per some firms); content removed from serving first (Ozone "Divert" and Bluesky "diverted" model), preserved securely 1 year, reported to NCMEC with account details, then user notified only as counsel and law enforcement permit. Whether to notify the user: not documented, ask counsel.
- Other escalation: Escalated queue for second opinion; life-or-safety threats go to law enforcement (DSA Art 18).

Metrics
- Time to first action and time to resolve versus SLA; queue age and backlog; reports per category; actions per policy; overturn rate on appeal; reviewer quality audit samples (TSPA lists "Content Moderation Quality Assurance", "User Appeals", "Metrics for Content Moderation" as chapters; chapter text not read); scanner match counts; NCMEC reports submitted; DSA-style transparency counts if applicable.

Daily digest email contents (my synthesis; no standard found, except Cloudflare's own daily CSAM detection email)
- Counts: new reports, by category; open vs resolved; SLA breaches and oldest open item age; appeals pending.
- Scanner results at upload: rejected count by reason and service name.
- Cloudflare CSAM tool detections in last 24 hours, and whether any block failed (Cloudflare's email states this).
- NCMEC reports filed and any pending.
- Escalations needing a decision; repeat offenders.
- Links to the portal only; never embed images or hashes' source content in email; no CSAM details beyond counts.

---

## Source list
- https://developers.cloudflare.com/cache/reference/csam-scanning/
- https://blog.cloudflare.com/the-csam-scanning-tool
- https://blog.cloudflare.com/a-simpler-path-to-a-safer-internet-an-update-to-our-csam-scanning-tool/
- https://www.microsoft.com/en-us/photodna/cloudservice
- https://www.microsoft.com/en-us/photodna/termsofuse
- https://www.thorn.org/blog/safer-match/
- https://thehive.ai/apis/csam-detection
- https://docs.thehive.ai/reference/image-and-video-csam-matching-api
- https://protectingchildren.google/tools-for-partners/
- https://atproto.com/specs/label
- https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/com/atproto/label/defs.json
- https://bsky.social/about/blog/03-12-2024-stackable-moderation
- https://bsky.social/about/blog/01-17-2025-moderation-2024
- https://bsky.social/about/blog/01-29-2026-transparency-report-2025
- https://bsky.social/about/blog/11-19-2025-moderation-updates
- https://github.com/bluesky-social/ozone/blob/main/docs/userguide.md
- https://www.law.cornell.edu/uscode/text/18/2258A
- https://www.law.cornell.edu/uscode/text/17/512
- https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2065
- https://docs.roost.tools/coop/1.0/user/review-console.html
- https://docs.roost.tools/coop/1.0/user/child-safety.html
- https://technologycoalition.org/wp-content/uploads/CSAM-Identification_Reporting_R3-1.pdf
- https://www.tspa.org/curriculum/ts-curriculum/
- https://vale.rocks/posts/moderation-tooling-design
