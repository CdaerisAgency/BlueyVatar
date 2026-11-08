/**
 * Profile exports: JSON, Markdown, and vCard (issue #242).
 *
 * Every format is built from `ExportProfile`, which `toExportProfile` copies out of the public
 * profile JSON that the delivery API already serves. Only the fields listed in `ExportProfile`
 * can reach an export, and each one is checked again here (https links only, wallets only when
 * the public JSON already lists them). Hidden wallets, email data, DIDs, plan, and anything
 * owner-only are never part of that input, so they cannot appear in a file.
 *
 * vCard rules come from RFC 6350 (vCard 4.0) and RFC 9554. Section numbers are cited next to each
 * property in `buildVcard`. This file has no node: imports so it stays bundle-safe.
 */
import { sanitizeProfileLinks, type ProfileLink } from './links.js'
import { cleanWallet, sanitizeLanguages, type ProfileLanguage, type ProfileWallet } from './profile-extras.js'

export const EXPORT_FORMATS = ['json', 'md', 'vcf'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: 'application/json; charset=utf-8',
  // text/markdown is registered by RFC 7763. text/vcard is the vCard 4.0 media type (RFC 6350 section 10.1).
  md: 'text/markdown; charset=utf-8',
  vcf: 'text/vcard; charset=utf-8',
}

export interface ExportVerifiedAccount {
  platform: string
  url: string
}

/** The public fields of one profile, and nothing else. */
export interface ExportProfile {
  handle: string | null
  profileUrl: string | null
  displayName: string | null
  description: string | null
  avatarUrl: string | null
  location: string | null
  jobTitle: string | null
  company: string | null
  pronouns: string | null
  interests: string[]
  languages: ProfileLanguage[]
  links: ProfileLink[]
  socialLinks: ProfileLink[]
  verifiedAccounts: ExportVerifiedAccount[]
  /** Only wallets the owner chose to show. Always marked not verified. */
  wallets: ProfileWallet[]
}

// ---------- input ----------

/** Removes control characters (keeps newline), bidi overrides and isolates, and the byte order mark. */
function stripUnsafe(s: string): string {
  return s
    .replace(/\r\n|[\r\u0085\u2028\u2029]/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
}

function text(v: unknown, multiline = false, max = 4000): string | null {
  if (typeof v !== 'string') return null
  let s = stripUnsafe(v).trim()
  if (!multiline) s = s.replace(/\s*\n\s*/g, ' ')
  if (s.length > max) s = [...s].slice(0, max).join('')
  return s === '' ? null : s
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname ? u.href : null
  } catch {
    return null
  }
}

export interface ExportSource {
  /** The object the delivery /profile route builds. Unknown extra keys are ignored. */
  profile: unknown
  /** Origin that relative avatar paths are resolved against (the delivery service's public origin). */
  deliveryOrigin: string
  /** Origin of the profile pages, such as https://blueyvatar.com. */
  profileBaseUrl: string
}

/** Copy the public fields out of the profile JSON. Everything else in it is dropped. */
export function toExportProfile(src: ExportSource): ExportProfile {
  const p = (src.profile && typeof src.profile === 'object' ? src.profile : {}) as Record<string, unknown>
  const handle = text(p.handle)
  let avatarUrl: string | null = null
  const av = p.avatar
  if (av && typeof av === 'object' && typeof (av as { url?: unknown }).url === 'string') {
    const path = (av as { url: string }).url
    // Signed delivery paths only, never an arbitrary URL.
    if (path.startsWith('/img/')) {
      try {
        const u = new URL(path, src.deliveryOrigin)
        // http is accepted for local development only; production origins are https.
        avatarUrl = u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
      } catch {
        avatarUrl = null
      }
    }
  }
  const base = src.profileBaseUrl.replace(/\/+$/, '')
  const wallets: ProfileWallet[] = []
  if (Array.isArray(p.wallets)) {
    for (const w of p.wallets.slice(0, 10)) {
      if (w && typeof w === 'object' && (w as { visible?: unknown }).visible === false) continue
      const c = cleanWallet(w && typeof w === 'object' ? { ...(w as object), visible: true } : null)
      if (c) wallets.push({ chain: c.chain, address: c.address, label: c.label, verified: false })
    }
  }
  const verified: ExportVerifiedAccount[] = []
  if (Array.isArray(p.verifiedAccounts)) {
    for (const a of p.verifiedAccounts) {
      if (!a || typeof a !== 'object') continue
      const { platform, uri, hidden } = a as { platform?: unknown; uri?: unknown; hidden?: unknown }
      const url = httpsUrl(uri)
      const name = text(platform, false, 64)
      if (hidden === true || !url || !name) continue
      verified.push({ platform: name, url })
    }
  }
  const interests = Array.isArray(p.interests)
    ? p.interests.map((i) => text(i, false, 50)).filter((i): i is string => i !== null).slice(0, 20)
    : []
  return {
    handle,
    profileUrl: handle ? `${base}/p/${encodeURIComponent(handle)}` : null,
    displayName: text(p.displayName, false, 640),
    description: text(p.description, true),
    avatarUrl,
    location: text(p.location),
    jobTitle: text(p.jobTitle),
    company: text(p.company),
    pronouns: text(p.pronouns),
    interests,
    languages: sanitizeLanguages(p.languages),
    links: sanitizeProfileLinks(p.links),
    socialLinks: sanitizeProfileLinks(p.socialLinks),
    verifiedAccounts: verified,
    wallets,
  }
}

// ---------- JSON ----------

export function buildJsonExport(p: ExportProfile): string {
  return JSON.stringify(p, null, 2) + '\n'
}

// ---------- Markdown ----------

/**
 * Backslash-escape every character that can start Markdown or HTML syntax in running text
 * (CommonMark section 2.4: any ASCII punctuation character may be backslash-escaped). The set also
 * covers ':', '/', '@' and '.' so text such as http://x or a@b.c cannot become an automatic link.
 * Newlines are removed by the caller (single-line text) or turned into hard breaks (descriptions).
 */
export function mdEscape(s: string): string {
  return stripUnsafe(s).replace(/[\\`*_{}[\]()<>#+\-.!|~&:@/="'$%^]/g, '\\$&')
}

function mdLine(s: string): string {
  return mdEscape(s.replace(/\s*\n\s*/g, ' '))
}

/** A destination that is safe inside `(...)`: parentheses, angle brackets, and spaces are percent-encoded. */
function mdDest(url: string): string {
  return url.replace(/[()<> \t]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

function mdCode(s: string): string {
  const runs = s.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1)
  return `${fence} ${s} ${fence}`
}

function languageName(tag: string): string {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag)
    return n && n !== tag ? `${n} (${tag})` : tag
  } catch {
    return tag
  }
}

export function buildMarkdown(p: ExportProfile): string {
  const out: string[] = []
  const name = p.displayName ?? p.handle ?? 'Profile'
  out.push(`# ${mdLine(name)}`, '')
  const head: string[] = []
  if (p.handle) head.push(mdLine(`@${p.handle}`))
  if (p.profileUrl) head.push(`[Profile page](${mdDest(p.profileUrl)})`)
  if (p.avatarUrl) head.push(`[Avatar](${mdDest(p.avatarUrl)})`)
  if (head.length) out.push(head.join(' · '), '')
  if (p.description) {
    out.push(p.description.split('\n').map((l) => mdEscape(l)).join('\\\n'), '')
  }
  const details: string[] = []
  if (p.pronouns) details.push(`- Pronouns: ${mdLine(p.pronouns)}`)
  if (p.jobTitle) details.push(`- Job title: ${mdLine(p.jobTitle)}`)
  if (p.company) details.push(`- Company: ${mdLine(p.company)}`)
  if (p.location) details.push(`- Location: ${mdLine(p.location)}`)
  if (p.interests.length) details.push(`- Interests: ${p.interests.map(mdLine).join(', ')}`)
  if (details.length) out.push('## Details', '', ...details, '')
  if (p.languages.length) {
    out.push('## Languages', '', ...p.languages.map((l) => `- ${mdLine(languageName(l.tag))}${l.primary ? ' (primary)' : ''}`), '')
  }
  const links = [...p.links, ...p.socialLinks]
  const seen = new Set<string>()
  const uniq = links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)))
  if (uniq.length) out.push('## Links', '', ...uniq.map((l) => `- [${mdLine(l.label)}](${mdDest(l.url)})`), '')
  if (p.verifiedAccounts.length) {
    out.push('## Verified accounts', '', ...p.verifiedAccounts.map((a) => `- [${mdLine(a.platform)}](${mdDest(a.url)})`), '')
  }
  if (p.wallets.length) {
    out.push(
      '## Wallets (not verified)',
      '',
      ...p.wallets.map((w) => `- ${w.label ? `${mdLine(w.label)}, ` : ''}${mdLine(w.chain)}: ${mdCode(w.address)} (not verified)`),
      '',
    )
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

// ---------- vCard ----------

const utf8Len = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

/**
 * Fold one content line (RFC 6350 section 3.2). Physical lines are at most 75 octets, excluding the
 * line break, and a continuation line starts with one space that counts toward the 75. A character
 * is never split across lines. Lines are joined with CRLF.
 */
export function vcardFold(line: string, max = 75): string {
  const parts: string[] = []
  let cur = ''
  let curLen = 0
  for (const ch of line) {
    const n = utf8Len(ch.codePointAt(0)!)
    if (curLen + n > max) {
      parts.push(cur)
      cur = ' '
      curLen = 1
    }
    cur += ch
    curLen += n
  }
  parts.push(cur)
  return parts.join('\r\n')
}

/**
 * Escape a TEXT value (RFC 6350 section 3.4): backslash, comma, and newline. A semicolon is only
 * escaped in compound values (`vcardEscapeComponent`), because the ABNF for `text` (section 4.1)
 * has no escaped semicolon while the `component` rule does. Control characters other than newline
 * are removed, and every line break form becomes the two characters backslash and n.
 */
export function vcardEscapeText(s: string): string {
  return stripUnsafe(s).replace(/[\\,]/g, '\\$&').replace(/\n/g, '\\n')
}

/** Escape one component of a structured value such as ORG or N: TEXT escaping plus the semicolon. */
export function vcardEscapeComponent(s: string): string {
  return vcardEscapeText(s).replace(/;/g, '\\;')
}

/**
 * A parameter value (RFC 6350 section 3.3: `param-value = *SAFE-CHAR / DQUOTE *QSAFE-CHAR DQUOTE`).
 * A double quote cannot appear in either form, so it is replaced with an apostrophe. Values with
 * a comma, semicolon, or colon are quoted. Line breaks are replaced with a space.
 */
export function vcardParamValue(s: string): string {
  const v = stripUnsafe(s).replace(/\n/g, ' ').replace(/"/g, "'")
  return /[,;:]/.test(v) ? `"${v}"` : v
}

/**
 * Build a vCard 4.0 file. Section numbers refer to RFC 6350 unless the line says RFC 9554.
 * Properties without an own line below are not emitted.
 */
export function buildVcard(p: ExportProfile): string {
  const lines: string[] = []
  const add = (l: string) => lines.push(vcardFold(l))
  add('BEGIN:VCARD') // 6.1.1
  add('VERSION:4.0') // 6.7.9: must come right after BEGIN, value "4.0"
  add(`FN:${vcardEscapeText(p.displayName ?? p.handle ?? 'Unknown')}`) // 6.2.1: required
  // N (6.2.2) is left out on purpose: it SHOULD be present only when the name follows the X.520
  // model, and a free-form display name cannot be split into family and given names without guessing.
  if (p.jobTitle) add(`TITLE:${vcardEscapeText(p.jobTitle)}`) // 6.6.1
  if (p.company) add(`ORG:${vcardEscapeComponent(p.company)}`) // 6.6.4: one component, the organization name
  if (p.pronouns) add(`PRONOUNS:${vcardEscapeText(p.pronouns)}`) // RFC 9554 3.4
  if (p.location) {
    // ADR (6.3.1) has seven structured components and the location is free text, so the components
    // stay empty and the text goes in the LABEL parameter (RFC 9554 4.5).
    add(`ADR;LABEL=${vcardParamValue(p.location)}:;;;;;;`)
  }
  if (p.description) add(`NOTE:${vcardEscapeText(p.description)}`) // 6.7.2
  if (p.interests.length) add(`CATEGORIES:${p.interests.map(vcardEscapeText).join(',')}`) // 6.7.1: text-list
  for (const l of p.languages) add(`LANG${l.primary ? ';PREF=1' : ''}:${l.tag}`) // 6.4.4 with PREF (5.3); tag is RFC 5646
  if (p.avatarUrl) add(`PHOTO:${p.avatarUrl}`) // 6.2.4: a URI, not embedded bytes
  // URI values are written as is. RFC 6350 section 6.2.4 shows a data URI with a comma and a
  // semicolon unescaped, and URL-value is a URI (6.7.8), so section 3.4 text escaping does not apply.
  if (p.profileUrl) add(`URL:${p.profileUrl}`) // 6.7.8
  const seen = new Set<string>()
  for (const l of p.links) {
    if (seen.has(l.url)) continue
    seen.add(l.url)
    add(`URL:${l.url}`) // 6.7.8. The RFC has no label parameter for URL, so labels are not exported.
  }
  for (const l of p.socialLinks) {
    if (seen.has(l.url)) continue
    seen.add(l.url)
    add(`SOCIALPROFILE:${l.url}`) // RFC 9554 3.5, default value type URI
  }
  for (const a of p.verifiedAccounts) {
    if (seen.has(a.url)) continue
    seen.add(a.url)
    add(`SOCIALPROFILE;SERVICE-TYPE=${vcardParamValue(a.platform)}:${a.url}`) // RFC 9554 3.5 and 4.9
  }
  for (const w of p.wallets) {
    // No standard property exists for wallets. X- names are allowed by section 6.10 and by the
    // x-name rule in section 3.3.
    const params = [`X-CHAIN=${vcardParamValue(w.chain)}`, ...(w.label ? [`X-LABEL=${vcardParamValue(w.label)}`] : []), 'X-VERIFIED=false']
    add(`X-BLUEYVATAR-WALLET;${params.join(';')}:${vcardEscapeText(w.address)}`)
  }
  add('END:VCARD') // 6.1.2
  return lines.join('\r\n') + '\r\n'
}

export function buildExport(format: ExportFormat, p: ExportProfile): string {
  return format === 'json' ? buildJsonExport(p) : format === 'md' ? buildMarkdown(p) : buildVcard(p)
}

/** A file name safe for Content-Disposition: letters, digits, dot, dash, underscore. */
export function exportFileName(handle: string | null, format: ExportFormat): string {
  const base = (handle ?? 'profile').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'profile'
  return `${base}.${format}`
}
