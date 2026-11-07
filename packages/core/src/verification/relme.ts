/** Reciprocal rel="me" check (docs/research/decisions-phase2-v1.md, Decision 1). Pure parsing, no network. */

const TAG = /<(a|link)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k === 'amp') return '&'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
  })

/** Attributes (lowercased names, decoded values) of every a and link element, with comments, scripts, and styles removed. */
export function tagAttributes(html: string): { tag: string; attrs: Record<string, string> }[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
  const out: { tag: string; attrs: Record<string, string> }[] = []
  for (const m of clean.matchAll(TAG)) {
    const attrs: Record<string, string> = {}
    for (const a of (m[2] ?? '').matchAll(ATTR)) {
      const name = (a[1] ?? '').toLowerCase()
      if (!(name in attrs)) attrs[name] = decode(a[2] ?? a[3] ?? a[4] ?? '')
    }
    out.push({ tag: (m[1] ?? '').toLowerCase(), attrs })
  }
  return out
}

/** Absolute hrefs of every a or link element whose rel token list contains "me". */
export function extractRelMe(html: string, base: string): string[] {
  const out: string[] = []
  for (const { attrs } of tagAttributes(html)) {
    if (!attrs.rel || !attrs.href) continue
    if (!attrs.rel.toLowerCase().split(/\s+/).includes('me')) continue
    try {
      out.push(new URL(attrs.href.trim(), base).href)
    } catch {
      /* skip unparseable hrefs */
    }
  }
  return out
}

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/** Same scheme, host, path (ignoring a trailing slash, case-insensitive), and query. The fragment is ignored. */
export function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.protocol === y.protocol && x.host === y.host && trimSlash(x.pathname).toLowerCase() === trimSlash(y.pathname).toLowerCase() && x.search === y.search
  } catch {
    return false
  }
}

export function hasRelMeLink(html: string, base: string, expected: string): boolean {
  return extractRelMe(html, base).some((h) => sameUrl(h, expected))
}
