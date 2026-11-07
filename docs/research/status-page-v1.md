# Service status for blueyvatar (v1)

Issue: CdaerisAgency/BlueyVatar#179. Status: decided by the owner (issue comment, 2026-11-07), partly built outside this repo, with two items left open at the end.

## Why

Pro and Business developers build on the delivery API. They need a way to tell "blueyvatar is down" from "my integration is wrong", and the owner needs to hear about an outage before a customer does. The repo already has `/healthz`, `/readyz`, `/api/health`, metrics, Sentry, and alert rules (`docs/deploy.md`, Observability). It has no place where someone can see current status, and no external probe.

A status page that runs on the same Fly apps goes dark in the same outage, so where the probe runs matters more than how the page looks.

## Decision

The owner ruled to monitor blueyvatar from the existing Cdaeris uptime dashboard (`CdaerisAgency/uptime`, Gatus on Fly, served at `uptime.cdaeris.com`) instead of building a separate status page. That repository already carries three blueyvatar rows, disabled until the first production deploy. So the choice among the options below is made, and nothing new is built or hosted for this issue.

| Option | Verdict |
| --- | --- |
| A status route inside the web app | Rejected. Dies with web and Fly. |
| Cloudflare Worker on the free plan reading probe results | Not needed. It would add a second probe system next to one that already exists. |
| Third-party hosted status page | Not needed. Adds an account and a recurring cost. |
| Existing Gatus dashboard | Chosen. Already deployed, already holds the rows, config lives in git. |

### Where the probe runs

Gatus runs on Fly, and so do all three blueyvatar apps. A Fly-wide outage would take the dashboard and the service down together. The uptime repository closes this for the dashboard itself: a Trigger.dev project (`monitoring/`, not on Fly, Vercel, or Neon) fetches `https://uptime.cdaeris.com/health` every five minutes and fails its run when the dashboard does not answer `200` with `{"status":"UP"}`. Its README records one manual step: the Trigger.dev alert (email) has to be created in that dashboard before a failed run reaches a person. That is an owner task in another repository and is not touched here.

The probes go through the public hostnames (`blueyvatar.com`, `img.blueyvatar.com`), so Cloudflare, DNS, and TLS are part of what green means.

## Components

What a developer or visitor depends on, and what watches it today.

| Component | Signal | Watched by | State |
| --- | --- | --- | --- |
| Avatar delivery | `GET https://img.blueyvatar.com/readyz` returns 200 and `status` of `ready` (runs `SELECT 1`, 503 `not_ready` otherwise) | Gatus row `delivery /readyz` | Row exists, disabled until first deploy |
| Delivery process | `GET https://img.blueyvatar.com/healthz` returns 200, no database | Gatus row `delivery /healthz` | Row exists, disabled until first deploy |
| Web app, sign-in, account pages | `GET https://blueyvatar.com/api/health` returns 200 and `status` of `ok` (runs `SELECT 1`, 503 `not_ready` otherwise) | Gatus row `web /api/health` | Row exists, disabled until first deploy. It proves the app and database answer. It does not run a sign-in. |
| Profile pages (`/p/<handle>`, `/u/<handle>`) | A real profile answering 200 | Nothing yet | Gap. Needs a fixed demo account to probe. See open items. |
| Indexer lag | `readyz` on port 8080 (internal) plus `indexer_tap_outbox_buffer` and `indexer_last_event_age_seconds` | Fly check, and the alert rules in `docs/deploy.md` | Not drawn on the dashboard. The indexer has no public address and Gatus cannot read a body over TCP. The alert rules page the owner instead. |

The three rows use the 4 hour interval the owner set on 2026-11-07. Both database rows run a real query, so a faster poll would keep the production Neon compute awake. A 4 hour interval means an outage can go unseen for up to 4 hours by this probe alone. The 5xx-rate and Indexer stalled alerts in `docs/deploy.md` are the faster signal, and the owner should read the Gatus rows as a slow, outside-the-platform second opinion.

## Data

Gatus stores its own history and exposes it at `/api/v1/endpoints/statuses` on the dashboard. The row names there are `blueyvatar_web-api-health`, `blueyvatar_delivery-readyz`, and `blueyvatar_delivery-healthz`. No blueyvatar customer data and no secret is involved: the probes send no header, because delivery exempts `/healthz` and `/readyz` from the `ORIGIN_SECRET` lock. Nothing in this repository stores probe results.

## Incident workflow

The dashboard is internal, so this is an owner workflow, not a public one.

1. Detect: a Gatus row goes red, a `docs/deploy.md` alert pages, or a developer writes in. The `x-request-id` header on any failing response ties a report to a log line.
2. Triage with the runbook in `docs/deploy.md` (Observability, alert rules, and Health and readiness). The three rows tell the cases apart: `/healthz` red means the delivery process is down. `/healthz` green with `/readyz` red means the database check failed. `web /api/health` red with delivery green points at the web app or its database connection.
3. Tell affected paying developers by email from `alerts@blueyvatar.com` when an outage lasts longer than the 4 hour poll or touches delivery. Keep the message to what is broken, what is known, and when the next update is due. Do not name customers or share logs.
4. Close: send a short resolution message, then record the cause and fix in the issue that tracks the incident.

## Open items for the owner

1. Enable the rows at the first production deploy. In `CdaerisAgency/uptime`, set `enabled: true` on the three blueyvatar rows in `config.yaml` and redeploy that dashboard. This is a change in another repository, so it is not made here.
2. Create the Trigger.dev alert for the dashboard watchdog (Alerts, email), per that repository's README. Without it a dead dashboard is a red run nobody hears about.
3. Decide whether paying developers get a public, read-only view. The dashboard is internal by the owner's ruling, because its other rows name Fly workers and Neon branches. As it stands, a Pro or Business developer has no way to check status themselves, and `/status` and a footer link do not exist. Possible shapes: a public Gatus instance with only the blueyvatar group, or a static page that mirrors only the three rows above. Either one is an infrastructure and hosting decision.
4. Optionally add two rows once the app is deployed: `GET https://blueyvatar.com/login` returning 200 (the sign-in page renders), and a fixed demo profile such as `GET https://img.blueyvatar.com/profile/<demo handle>` returning 200 with the demo account created. Both would use the 4 hour interval.
