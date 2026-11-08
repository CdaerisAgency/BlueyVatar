/**
 * Languages, social links, and wallets on com.blueyvatar.profile (issue #242).
 *
 * This is the one place that turns raw record values into the public shape. The delivery API,
 * the profile page, and later exports all read the result of `profileExtras`. Raw wallets with
 * visible false never leave this module.
 *
 * Language tags: BCP 47 (RFC 5646), the same type as the atproto Lexicon `language` string
 * format (https://atproto.com/specs/lexicon). Only structural well-formedness is checked.
 * Wallet addresses: only generic rules (length, no whitespace, no control characters). No
 * chain-specific format is checked and no ownership is verified.
 */
import { sanitizeProfileLinks, type ProfileLink } from './links.js'

export const MAX_LANGUAGES = 10
export const MAX_LANGUAGE_TAG_LENGTH = 35
export const MAX_SOCIAL_LINKS = 10
export const MAX_WALLETS = 10
export const MAX_WALLET_CHAIN_GRAPHEMES = 32
export const MAX_WALLET_ADDRESS_GRAPHEMES = 128
export const MAX_WALLET_LABEL_GRAPHEMES = 50
export const MAX_SOCIAL_LABEL_GRAPHEMES = 50

export interface ProfileLanguage {
  /** Canonical BCP 47 tag, such as en or pt-BR. */
  tag: string
  primary: boolean
}
export interface ProfileWallet {
  chain: string
  address: string
  label: string | null
  /** Always false. Wallets are self-declared. */
  verified: false
}
export interface ProfileExtras {
  languages: ProfileLanguage[]
  socialLinks: ProfileLink[]
  /** Only wallets the owner chose to show. */
  wallets: ProfileWallet[]
}

export function graphemeCount(s: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let n = 0
    for (const _ of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)) n++
    return n
  }
  return [...s].length
}

const CONTROL_OR_SPACE = /[\s\p{Cc}\p{Cf}\u2028\u2029]/u
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/** Returns the canonical tag when `raw` is a well-formed BCP 47 tag, else null. */
export function normalizeLanguageTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.length > MAX_LANGUAGE_TAG_LENGTH || !/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(t)) return null
  try {
    return Intl.getCanonicalLocales(t)[0] ?? null
  } catch {
    return null
  }
}

export function sanitizeLanguages(raw: unknown): ProfileLanguage[] {
  if (!Array.isArray(raw)) return []
  const out: ProfileLanguage[] = []
  let havePrimary = false
  for (const item of raw.slice(0, MAX_LANGUAGES)) {
    if (!item || typeof item !== 'object') continue
    const tag = normalizeLanguageTag((item as { tag?: unknown }).tag)
    if (!tag || out.some((l) => l.tag === tag)) continue
    const primary = (item as { primary?: unknown }).primary === true && !havePrimary
    if (primary) havePrimary = true
    out.push({ tag, primary })
  }
  return out
}

export function sanitizeSocialLinks(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ProfileLink[] = []
  for (const l of sanitizeProfileLinks(raw.slice(0, MAX_SOCIAL_LINKS))) {
    if (seen.has(l.url)) continue
    seen.add(l.url)
    out.push(l)
  }
  return out
}

/** Check one wallet. Returns null when it breaks a generic rule. */
export function cleanWallet(w: unknown): { chain: string; address: string; label: string | null; visible: boolean } | null {
  if (!w || typeof w !== 'object') return null
  const { chain, address, label, visible } = w as Record<string, unknown>
  if (typeof chain !== 'string' || typeof address !== 'string') return null
  const c = chain.trim()
  const a = address.trim()
  if (!c || graphemeCount(c) > MAX_WALLET_CHAIN_GRAPHEMES || CONTROL.test(c)) return null
  if (!a || graphemeCount(a) > MAX_WALLET_ADDRESS_GRAPHEMES || CONTROL_OR_SPACE.test(a)) return null
  let l: string | null = null
  if (typeof label === 'string' && label.trim()) {
    l = label.trim()
    if (graphemeCount(l) > MAX_WALLET_LABEL_GRAPHEMES || CONTROL.test(l)) return null
  }
  return { chain: c, address: a, label: l, visible: visible === true }
}

/** Wallets the owner opted in to show. Hidden is the default for anything not exactly true. */
export function sanitizeVisibleWallets(raw: unknown): ProfileWallet[] {
  if (!Array.isArray(raw)) return []
  const out: ProfileWallet[] = []
  for (const w of raw.slice(0, MAX_WALLETS)) {
    const c = cleanWallet(w)
    if (c?.visible) out.push({ chain: c.chain, address: c.address, label: c.label, verified: false })
  }
  return out
}

/** The public shape of the three new fields, from a raw com.blueyvatar.profile record. */
export function profileExtras(record: { languages?: unknown; socialLinks?: unknown; wallets?: unknown } | null | undefined): ProfileExtras {
  return {
    languages: sanitizeLanguages(record?.languages),
    socialLinks: sanitizeSocialLinks(record?.socialLinks),
    wallets: sanitizeVisibleWallets(record?.wallets),
  }
}
