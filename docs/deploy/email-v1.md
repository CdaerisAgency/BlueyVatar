# Email routing

Cloudflare Email Routing (free) forwards domain addresses to a real inbox. It receives and forwards only; it does not send mail.

- Addresses: `security@blueyvatar.com` (the vulnerability contact in `SECURITY.md`), `support@blueyvatar.com` (general help, including the accessibility page), and `alerts@blueyvatar.com`. Each has its own routing rule. The `support@` rule was added and tested on 2026-11-07.
- Destination: `chris@cdaeris.com`. Cloudflare sends a verification email to a new destination address, and rules cannot forward to it until that link is clicked.
- DNS: Email Routing adds the MX records (`route1`, `route2`, `route3.mx.cloudflare.net`), the SPF TXT record `v=spf1 include:_spf.mx.cloudflare.net ~all`, and a DKIM record at `cf2024-1._domainkey`. Do not add other MX records or a second SPF record for the apex; a domain can publish only one SPF record.
- Token: the API token used for setup is in Infisical project `blueyvatar`, environment `prod`, as `Cloudflare Bluey Setup Token`. It needs Zone: Email Routing Rules Edit, Zone: DNS Edit, and Account: Email Routing Addresses Edit. Never commit its value.
- To add an address: `POST /zones/{zone_id}/email/routing/rules` with a `literal` matcher on `to` and a `forward` action. To add a destination: `POST /accounts/{account_id}/email/routing/addresses`. Docs: <https://developers.cloudflare.com/email-routing/>.

## Notification emails

Usage alerts (80 and 100 percent), billing notices (failed payment, grace expiry, cancellation), and key revoked notices are mailed to the account's primary email from `notice_emails` (issue 144). Delivery and web both send through Resend, so set `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_URL`, and `TOKEN_ENCRYPTION_KEY` on both apps. Without a stored address delivery logs the usage alert instead. Owners switch usage and billing messages off at `/account/notifications` (migration 0019); security notices stay on. Grace expiry is mailed when Stripe ends a subscription that was past due, since the license itself drops to Free limits with no event.
