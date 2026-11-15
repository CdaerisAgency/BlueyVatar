# Bug reports

The bug report button (issue 266) is a floating button on every page. A signed-in person describes the problem, optionally attaches a screenshot, and the web server files a GitHub issue. The browser never holds a token.

### Owner step: create and store the token

1. In GitHub, create a fine-grained personal access token. Resource owner: the organization that owns the repository. Repository access: only the repository that receives the issues. Repository permissions: **Issues: Read and write** (Metadata read-only is added automatically). Nothing else. Pick an expiry and note the renewal date.
2. Store it in Infisical as `GITHUB_FEEDBACK_TOKEN` (staging: `STAGING_GITHUB_FEEDBACK_TOKEN`).
3. Set it on the web app as a Fly secret, and optionally the repository: `fly secrets set GITHUB_FEEDBACK_TOKEN=<value> --app <web app>`. Do the staging app first and file a test issue before production. Use `GITHUB_FEEDBACK_REPO=owner/name` to point staging at a test repository. It defaults to `CdaerisAgency/BlueyVatar`.

Agents do not create or set this token. Names only are in `.env.example`.

### Behavior to know

- **Variable unset:** the button is hidden on every page and `POST /api/bug-report` answers 503 "Bug reports are unavailable right now." Nothing else changes. The value is read at request time, so a Fly secret change takes effect on the next machine restart.
- **Who can file:** signed-in accounts only (401 otherwise; signed-out visitors who open the button see a sign-in link). Limits are in the Web rate limits table: 5 per account and 20 per network per hour. A hidden field that people never see catches simple bots (the request looks successful and files nothing), the description is 10 to 2,000 characters with at most 3 links, and the request body is capped at 16 KB.
- **The issue:** the title is the first line of the description (no `Bug report:` prefix, at most 200 characters, with links, `#numbers`, and `@names` removed, per `FEEDBACK-ISSUE-CONVENTIONS-v4.md` in CdaerisAgency/cadence-v2). The body has the description, the page path (no query string or fragment), window size, browser string, and the build (`SENTRY_RELEASE`, else `FLY_IMAGE_REF`). `@names` and `#numbers` are defused so a report cannot ping people or link issues. The handle is named only if the person ticks the box (it falls back to the account ID, as in notification emails), and the contact email only if they type one; the dialog says both can be public. The only label is `bug`, the conventions' kind label, which exists. The route never creates labels, adds no status or other labels, and does no triage.
- **Screenshots** (migration 0040, table `bug_report_screenshots`): GitHub has no REST endpoint that uploads an image to an issue, so the dialog sends the picture with the report and the server keeps it in Postgres. The browser re-draws it as a JPEG; the server then re-encodes it again with sharp (metadata dropped, 1,600 pixels on the long side, at most 1 MB, PNG, JPEG, or WebP in, at most 40 megapixels). The issue holds one line with a link to `/admin/bug-reports/<id>/screenshot`. That route uses `requireAdmin`: 404 unless the account is on `ADMIN_DIDS`, and the admin password and TOTP session is required (an admin without one is sent to `/admin/login` and opens the link again afterwards). If the issue cannot be filed the stored picture is deleted. The indexer job `scheduleScreenshotPurge` deletes screenshots older than 90 days daily. Account deletion removes the account's screenshots, and the data export includes them (base64).
- **Privacy:** the repository will be public (issues 213 and 214), so every issue is public, but screenshots are not: they are in the database behind the admin sign-in. The dialog warns about this and about personal information in screenshots, and the privacy page has a section on report screenshots.

### What differs from Cadence

| Cadence | BlueyVatar |
| --- | --- |
| Icon beside Help in the signed-in app header | Floating button on every page (the site has no signed-in app header) |
| Screenshot saved in Cadence's database, linked from the issue | Same: saved in Postgres, linked from the issue, admins only, deleted after 90 days |
| Up to 3 screenshots, drag and drop, paste | One screenshot: capture this tab (where the browser supports it) or attach a picture |
| Token `FEEDBACK_GITHUB_TOKEN`, repository a constant | `GITHUB_FEEDBACK_TOKEN`, repository in `GITHUB_FEEDBACK_REPO` |
| No limit beyond sign-in and body length | Per-account and per-network limits, hidden field, link cap |
| Issue names the reporter and company | Handle only with consent; contact email only if typed |
| Cadence labels (21-label standard) | Only `bug`. The 21 labels are not created here; see issue 266 |
| Report kinds, help requests, Feedback board mirror | Bugs only; the feature only files issues |
