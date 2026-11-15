/** Parser and Atom feed for CHANGELOG.md and the changelog.d/ fragments at the repo root (issue #178). */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { absoluteUrl } from './site'
import { xmlEscape } from './seo'

export const CHANGELOG_GROUPS = ['Added', 'Changed', 'Fixed'] as const
export type ChangelogGroupName = (typeof CHANGELOG_GROUPS)[number]

export interface ChangelogGroup {
  name: ChangelogGroupName
  items: string[]
}
export interface ChangelogEntry {
  /** ISO date, YYYY-MM-DD. Also the anchor id. */
  date: string
  groups: ChangelogGroup[]
}

/** Reads CHANGELOG.md. Next builds from apps/web and tests run there too, so both the repo root and the app folder are tried. */
export function readChangelogFile(cwd: string = process.cwd()): string {
  for (const p of [join(cwd, '../../CHANGELOG.md'), join(cwd, 'CHANGELOG.md')]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // try the next location
    }
  }
  return ''
}

/** Reads changelog.d/YYYY-MM-DD-*.md (README.md and other names are ignored), sorted by name. Same locations as the file. */
export function readChangelogFragments(cwd: string = process.cwd()): { date: string; md: string }[] {
  for (const dir of [join(cwd, '../../changelog.d'), join(cwd, 'changelog.d')]) {
    try {
      return readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
        .sort()
        .map((f) => ({ date: f.slice(0, 10), md: readFileSync(join(dir, f), 'utf8') }))
    } catch {
      // try the next location
    }
  }
  return []
}

const DATE_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/
const GROUP_HEADING = /^###\s+(.+?)\s*$/
const ITEM = /^[-*]\s+(.+?)\s*$/

/** Parses dated `##` entries with `###` Added/Changed/Fixed groups and `-` items. Newest first as written; unknown groups and stray lines are ignored. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let entry: ChangelogEntry | null = null
  let group: ChangelogGroup | null = null
  for (const line of md.split(/\r?\n/)) {
    const d = DATE_HEADING.exec(line)
    if (d) {
      entry = { date: d[1]!, groups: [] }
      entries.push(entry)
      group = null
      continue
    }
    if (/^##\s/.test(line)) {
      entry = null
      group = null
      continue
    }
    const g = GROUP_HEADING.exec(line)
    if (g && entry) {
      const name = CHANGELOG_GROUPS.find((n) => n.toLowerCase() === g[1]!.toLowerCase())
      group = name ? { name, items: [] } : null
      if (group) entry.groups.push(group)
      continue
    }
    const it = ITEM.exec(line)
    if (it && group) group.items.push(it[1]!)
  }
  return entries.filter((e) => e.groups.some((x) => x.items.length > 0))
}

/** Merges fragments into parsed entries: items join the section for the fragment's date (created in date order, newest first) under the matching group. */
export function mergeFragments(entries: ChangelogEntry[], fragments: { date: string; md: string }[]): ChangelogEntry[] {
  const out: ChangelogEntry[] = entries.map((e) => ({ date: e.date, groups: e.groups.map((g) => ({ ...g, items: [...g.items] })) }))
  for (const f of fragments) {
    for (const part of parseChangelog(`## ${f.date}\n${f.md}`)) {
      let entry = out.find((e) => e.date === part.date)
      if (!entry) {
        entry = { date: part.date, groups: [] }
        const at = out.findIndex((e) => e.date < part.date)
        out.splice(at === -1 ? out.length : at, 0, entry)
      }
      for (const g of part.groups) {
        const into = entry.groups.find((x) => x.name === g.name)
        if (into) into.items.push(...g.items)
        else entry.groups.push({ name: g.name, items: [...g.items] })
      }
    }
  }
  return out
}

/** CHANGELOG.md plus fragments, ready to render. */
export function loadChangelog(cwd: string = process.cwd()): ChangelogEntry[] {
  return mergeFragments(parseChangelog(readChangelogFile(cwd)), readChangelogFragments(cwd))
}

export const changelogAnchor = (e: ChangelogEntry): string => e.date

/** Splits an item into text and `code` runs. */
export function inlineParts(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((t) => (t.startsWith('`') && t.endsWith('`') && t.length > 2 ? { code: true, text: t.slice(1, -1) } : { code: false, text: t }))
}

const plain = (text: string): string => text.replace(/`([^`]+)`/g, '$1')

function entryHtml(e: ChangelogEntry): string {
  return e.groups
    .filter((g) => g.items.length > 0)
    .map((g) => `<h3>${xmlEscape(g.name)}</h3><ul>${g.items.map((i) => `<li>${xmlEscape(plain(i))}</li>`).join('')}</ul>`)
    .join('')
}

/** Atom feed of the entries, one per date. Dates are UTC midnight, so the output is stable. */
export function changelogFeed(entries: ChangelogEntry[], base: string): string {
  const page = absoluteUrl('/changelog', base)
  const stamp = (d: string): string => `${d}T00:00:00Z`
  const updated = entries.length > 0 ? stamp(entries.map((e) => e.date).sort().at(-1)!) : '1970-01-01T00:00:00Z'
  const items = entries
    .map((e) => {
      const url = `${page}#${changelogAnchor(e)}`
      return `<entry><id>${xmlEscape(url)}</id><title>${xmlEscape(`Changes for ${e.date}`)}</title><link rel="alternate" type="text/html" href="${xmlEscape(url)}"/><updated>${stamp(e.date)}</updated><content type="html">${xmlEscape(entryHtml(e))}</content></entry>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xmlEscape(page)}</id><title>BlueyVatar changelog</title><link rel="self" type="application/atom+xml" href="${xmlEscape(absoluteUrl('/changelog/feed.xml', base))}"/><link rel="alternate" type="text/html" href="${xmlEscape(page)}"/><updated>${updated}</updated>${items}</feed>`
}
