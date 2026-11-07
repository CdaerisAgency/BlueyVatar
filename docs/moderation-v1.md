# Moderation review guide (v1)

For the people who review reports on blueyvatar. It explains how to use the portal at `/admin`, what the severity levels and timers mean, and how to look after yourself while doing this work. The settings an operator changes are in `docs/deploy.md` under "Web admin page".

The portal follows published designs instead of a process invented for this project: Ozone (Bluesky's open source moderation tool), ROOST Coop (queues, blur, one reviewer per job), and the statement of reasons in Article 17 of the EU Digital Services Act. Where a rule here is our own choice, it says so. This guide is not legal advice. Counsel must confirm the child-safety steps and the notice wording.

## The short version

1. Open `/admin`, sign in, and enter your six-digit code.
2. Pick a queue and press "Take the next case". The portal gives you the most severe, oldest case that nobody else has, and locks it to you for 15 minutes (renewed each time you reopen the page).
3. Read the signals first. Images stay blurred and gray until you reveal them. Reveal only what you need.
4. Choose an action. Every action needs a reason (for the internal log) and a policy from the list. Actions that tell the account owner also need the facts and the explanation in plain words.
5. Press "Skip to the next case" if you do not want a case. It goes back in the queue and stays out of your picks for 4 hours.

## Queues

| Queue | What is in it |
| --- | --- |
| Unreviewed | New cases nobody has acted on. |
| Escalated | Cases a reviewer sent for a second opinion. Ask a different reviewer than the one who escalated. |
| Appeals | Appeals from account owners about a takedown, suspension, warning, or rating change. A different admin than the one who took the action must decide. |
| Resolved | Closed cases, newest first. You can still comment, tag, or reverse an action from here. |
| Child safety (restricted) | Cases that involve a child-safety report, scanner result, or label. The image is never shown. See below. |

Cases are ordered by severity (Critical, High, Moderate, Low), then oldest first. Each case shows how long is left on its timer, or how long it is overdue.

One case covers one image (its CID) or one account (its DID). New reports, scanner results, and label hits for the same image join the open case instead of making a second one. A signal about an account without an image joins the oldest open case for that account. Once a case is resolved, a new signal opens a fresh case.

## Severity

A case takes the most severe of its signals.

| Severity | Examples |
| --- | --- |
| Critical | Anything about child safety: a child-safety report, an upload the screening service refused after a hash match (see below), or a scanner or label signal in that category. |
| High | "Illegal content" reports. Scanner or label signals for explicit sexual content, graphic violence or gore, or self-harm, and removal labels (`!takedown`, `!suspend`, `!hide`). |
| Moderate | Explicit content rated too low, impersonation, threats or harassment, private information, copyright. Other scanner or label signals. Appeals. Cases a reviewer opened by hand. |
| Low | Spam or scams, and "something else". |

## Timers (SLA)

Defaults: Critical 4 hours, High 24 hours, Moderate 72 hours, Low 168 hours (7 days), counted from the oldest signal in the case. The operator can change them with `MODERATION_SLA_HOURS`. These numbers are our starting point. No published source sets them. For child safety the legal standard is reporting "as soon as reasonably possible" after actual knowledge (18 U.S.C. 2258A), so do not let a Critical case wait on its timer.

Appeals are Moderate, so they are due inside the 7 days the content policy page promises.

## The case page

- Summary: severity, status, timer, tags, and who holds the lock. If someone else holds it, you can read the case but not act.
- Why this case exists: how many reports and in which categories, any scanner result (service and category), any label, and the appeal if there is one. Reporter identity is hidden. The portal never reads a reporter's email or IP hash.
- Images: hidden by default.
- History: other cases on the account, how many actions the account has had, whether other accounts use the same image hash and what happened to them, current blocks, any suspension, and any rating changes.
- Actions, then the case log (every action on this case, with who, why, which policy, and whether a notice was sent).

## Actions

Every action needs a reason (up to 500 characters, internal) and a cited policy. Without both, nothing happens.

| Action | What it does | Notice to the owner |
| --- | --- | --- |
| Acknowledge or dismiss | Closes the case with no action. Linked reports are marked dismissed and reporters who left an address are told. | None |
| Remove image | Stops serving one image, or all images of the account, and purges the cache. Closes the case. | Yes |
| Apply rating change | Sets a new rating for one image. It stays in force even if the owner's record is re-indexed. Closes the case. | Yes |
| Warn | Records a warning. Nothing is restricted. Closes the case. | Yes |
| Suspend account | Stops serving all images until lifted. Closes the case. | Yes |
| Escalate | Sends the case to the Escalated queue. A checkbox sends it to the restricted child-safety queue instead and takes the image out of serving at once. | None |
| Reverse | Unblocks an image, lifts a suspension, or restores a rating. Works on resolved cases. | Yes |
| Comment, Tag | A note, or a tag such as `repeat-offender`. | None |
| Divert | Child-safety cases only. Takes the image out of serving. | None |
| Uphold, Overturn | Appeals only. Overturning also reverses the original action. | The appeal outcome message |

Timed restrictions are not built. Every removal, suspension, and rating change lasts until a reviewer reverses it or an appeal succeeds, and the notice says so.

## Notices to account owners (DSA Article 17)

Each notice that tells an owner about an action is a statement of reasons with the fields Article 17(3) lists:

1. The action and how long it lasts (filled in for you from the action).
2. The facts and circumstances relied on, and whether they came from a notice from a user or from our own initiative. You write the facts. The source line is filled in from the signals.
3. Whether automated means were used. Filled in: "Yes" when a scanner or label signal is on the case, otherwise "No".
4. The ground: the policy you cited, a link to the content policy, and your plain-words explanation of why the content breaks it.
5. The ways to challenge it: the appeal link for this action (one appeal per action, decided by someone else), and the out-of-court settlement and court options.

Write for the account owner, not for other reviewers. Keep it clear and specific, and do not include reporter details. If any field is empty, or contains a leftover `{{placeholder}}`, the action is refused and nothing changes. The audit log records which template was sent and whether the send worked ("sent", "no_address", "failed"), not the text. If the owner has no email on file, the action still goes through and the page says the owner was not emailed.

## Child-safety cases (restricted)

- The portal never shows these images and holds only metadata for them. The image route refuses child-safety cases even if someone types the address.
- Only the DIDs in `MODERATION_CHILD_SAFETY_DIDS` can open the queue, when that variable is set.
- The only actions are Divert (remove from serving), Comment, Tag, and, after a divert, closing the case.
- Reporting to NCMEC is on hold pending counsel. The case page says so and has no submit button. Do not report from this portal, and do not copy or save the image. Follow counsel's written guidance for preservation (18 U.S.C. 2258A treats a report as a request to preserve for one year), for reporting, and for whether to tell the account owner. If a case involves a threat to someone's life or safety, DSA Article 18 asks us to inform law enforcement promptly. Ask counsel how.
- A refused upload that matched the screening service's hash list opens a Critical case about the account here, even though nothing was stored. Treat it as a child-safety case and follow counsel's guidance.
- If you meet child-safety content in another queue, use Escalate, tick the child-safety box, and stop looking at it. Take a break.

## Looking after yourself

- Start blurred and gray. Reveal one image at a time, and only when the signals are not enough. Every reveal is logged. That is for accountability and for working out how much exposure the work involves. It is not a score.
- You can raise or lower the blur and turn grayscale on or off while you review, and save your choice as your default. The default is 16 px blur with grayscale on.
- No audio and no autoplay. If a case gets hard, use Skip. You never need a reason to skip.
- Take breaks, rotate with other work, and talk to someone you trust. Blur and grayscale are sensible defaults, not proof of protection. Studies of blur and grayscale are mixed (one found interactive blur reduces emotional impact, another found static blur reduces accuracy, a recent paper doubts the effect), so do not rely on them alone.
- No published source sets a daily limit on exposure. The portal has none. Agree limits with a wellness professional, and see the Tech Coalition's guidance on specialist wellbeing.
- If this work is affecting you, stop and tell the operator. That is a normal reason to stop.

## The audit log

Everything is written to one append-only log (`/admin/audit`): every action with the actor, the time, the reason, the policy, the case, and any notice. Reveals are logged as well. The database refuses updates and deletes on the log. Nothing you do can be edited later, so write reasons you would be comfortable defending.

## Metrics on the admin home

Last 30 days: median time to first action; median time to resolve and the share resolved within each severity's timer; backlog size, oldest case, and median age; and the overturn rate on appeals (appeals overturned out of appeals decided). A rising overturn rate means decisions or notices need another look.

## The daily digest

Once a day (from 13:00 UTC by default) the indexer emails counts to the admin address: new reports by category, SLA breaches, the oldest open case, upload rejections by reason and service, cases opened by labels, escalations and appeals waiting, the number of open child-safety cases, a reminder about Cloudflare's own CSAM tool email, and a link to the portal. It never contains images, account identifiers, or report text. On a day with nothing to report it is not sent, unless `MODERATION_DIGEST_ALWAYS` is set.

## Not built yet, and open questions

- NCMEC reporting and evidence preservation: waiting for counsel (see `blueyvatar-research/moderation-research-v1.md`, section 4).
- Per-reviewer daily exposure caps and exposure rotation: no standard exists. Decide with a wellness professional.
- Keyboard shortcuts, video and audio handling: not needed while the service holds only images.
- Roles beyond "admin" and the child-safety list: the portal has no separate roles for a triage-only reviewer. Add them if the team grows.
- Quality audit samples (second review of a share of decisions): suggested by the research, not built.
- Whether blueyvatar is a hosting service or online platform under the DSA, and which transparency and complaint-handling duties apply, is for counsel.
