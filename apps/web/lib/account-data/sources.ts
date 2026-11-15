/** Account export queries, one per source, each bound to the DID as $1 (the licenses owner for api keys). Add a feature's query next to its siblings; `exportAccountData` shapes the result. */
export type SourceKey = 'links' | 'holds' | 'notice' | 'profileLinks' | 'claims' | 'attestations' | 'rules' | 'licenses' | 'keys' | 'domains' | 'customers' | 'subs' | 'images' | 'profile' | 'views' | 'orgs' | 'orgAudit' | 'appeals' | 'avatarSync' | 'avatarLog' | 'bugShots' | 'effects' | 'offers' | 'calendar'
export type ExportSource = { key: SourceKey; sql: string }

export const EXPORT_SOURCES: ExportSource[] = [
  { key: 'links', sql: 'SELECT email_hash, method, is_primary, email_domain, email_enc, verified_at FROM email_links WHERE did = $1 ORDER BY is_primary DESC, verified_at, email_hash' },
  { key: 'holds', sql: 'SELECT email_hash, reason, released_at FROM email_holds WHERE did = $1 ORDER BY released_at' },
  { key: 'notice', sql: 'SELECT email_enc FROM notice_emails WHERE did = $1' },
  { key: 'profileLinks', sql: 'SELECT rkey, url, title, created_at FROM profile_links WHERE did = $1 ORDER BY created_at, rkey' },
  { key: 'claims', sql: 'SELECT rkey, platform, uri, record, indexed_at FROM claims WHERE did = $1 ORDER BY rkey' },
  { key: 'attestations', sql: 'SELECT uri, claim_rkey, result, method, created_at FROM attestations WHERE claim_did = $1 ORDER BY created_at' },
  { key: 'rules', sql: 'SELECT keyed_only, domain_allowlist, hidden_profile, email_lookup_opt_out, updated_at FROM visibility_rules WHERE did = $1' },
  { key: 'licenses', sql: 'SELECT license_id, org_id, tier, status, term, entitlements, grace_ends_at, created_at FROM licenses WHERE owner = $1 ORDER BY created_at' },
  { key: 'keys', sql: 'SELECT k.prefix, k.kind, k.label, k.domains, k.created_at, k.revoked_at, k.expires_at FROM api_keys k JOIN licenses l ON l.license_id = k.license_id WHERE l.owner = $1 ORDER BY k.created_at' },
  { key: 'domains', sql: 'SELECT hostname, status, created_at, verified_at FROM custom_domains WHERE did = $1' },
  { key: 'customers', sql: 'SELECT stripe_customer_id, created_at FROM billing_customers WHERE did = $1' },
  { key: 'subs', sql: 'SELECT stripe_subscription_id, tier, status, current_period_end, cancel_at_period_end, deleted_at FROM subscriptions WHERE did = $1 ORDER BY stripe_subscription_id' },
  { key: 'images', sql: 'SELECT rkey, cid, mime_type, rating, is_default, license, created_at FROM images WHERE did = $1 ORDER BY created_at, rkey' },
  { key: 'profile', sql: 'SELECT record FROM profiles WHERE did = $1' },
  { key: 'views', sql: "SELECT to_char(day, 'YYYY-MM-DD') AS day, views, json_calls FROM profile_view_counters WHERE did = $1 ORDER BY day" },
  { key: 'orgs', sql: 'SELECT o.org_id, o.name, m.role, m.added_at FROM organization_members m JOIN organizations o ON o.org_id = m.org_id WHERE m.did = $1 ORDER BY m.added_at, o.org_id' },
  { key: 'orgAudit', sql: 'SELECT org_id, actor, action, target_did, detail, created_at FROM organization_audit WHERE actor = $1 OR target_did = $1 ORDER BY id' },
  { key: 'appeals', sql: "SELECT p.id, a.action AS appealed_action, p.action_id, p.statement, p.status, p.created_at, p.decided_at FROM appeals p JOIN admin_actions a ON a.id = p.action_id WHERE p.did = $1 ORDER BY p.id" },
  { key: 'avatarSync', sql: 'SELECT auto_sync, previous_avatar, has_previous, last_source_cid, last_sent_cid, auto_notice_pending, auto_count, updated_at FROM bsky_avatar_sync WHERE did = $1' },
  { key: 'avatarLog', sql: 'SELECT action, from_cid, to_cid, source_cid, created_at FROM bsky_avatar_log WHERE did = $1 ORDER BY id' },
  { key: 'bugShots', sql: "SELECT issue_number, created_at, encode(image, 'base64') AS image_base64 FROM bug_report_screenshots WHERE did = $1 ORDER BY created_at, id" },
  { key: 'effects', sql: "SELECT frame_style, frame_color, filter_id, to_char(away_start_on, 'YYYY-MM-DD') AS away_start_on, to_char(away_end_on, 'YYYY-MM-DD') AS away_end_on, away_timezone, away_prev_default_rkey FROM avatar_effects WHERE did = $1" },
  { key: 'offers', sql: "SELECT o.name, o.effect, u.listed, u.emailed_at, u.dismissed_at FROM effect_offer_users u JOIN effect_offers o ON o.id = u.offer_id WHERE u.did = $1 ORDER BY o.id" },
  { key: 'calendar', sql: 'SELECT schedule, holidays, timezone, next_change_at, state, applied_image, prev_default, created_at, updated_at FROM avatar_schedule WHERE did = $1' },
]

/** A plain `DELETE FROM table WHERE column = $1` for the DID. */
export type DeleteStep = { table: string; column: string }

/** Deleted in this order inside the purge transaction (foreign keys depend on it). Runs before the license lock and organization step. */
export const DELETE_STEPS: DeleteStep[] = [
  { table: 'oauth_session', column: 'sub' },
  { table: 'web_session', column: 'did' },
  { table: 'session_floor', column: 'did' },
  { table: 'profile_links', column: 'did' },
  { table: 'visibility_rules', column: 'did' },
  { table: 'verification_state', column: 'did' },
  { table: 'custom_domains', column: 'did' },
  { table: 'profile_view_counters', column: 'did' },
  { table: 'appeals', column: 'did' },
  { table: 'bsky_avatar_sync', column: 'did' },
  { table: 'bsky_avatar_log', column: 'did' },
  { table: 'bug_report_screenshots', column: 'did' },
  { table: 'avatar_effects', column: 'did' },
  { table: 'effect_offer_users', column: 'did' },
  { table: 'avatar_schedule', column: 'did' },
  { table: 'images', column: 'did' },
  { table: 'profiles', column: 'did' },
  { table: 'claims', column: 'did' },
  { table: 'attestations', column: 'claim_did' },
]
