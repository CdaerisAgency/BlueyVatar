import { describe, expect, it } from 'vitest'
import { changelogFeed, inlineParts, mergeFragments, parseChangelog, readChangelogFile, readChangelogFragments } from './changelog'

const md = `# Changelog

intro

## 2026-11-07

### Added
- First thing (#1).
- Uses \`/img\` & more (#2).

### Fixed
- A bug (#3).

### Other
- ignored

## 2026-11-03

### Changed
- Moved hosts (#4).

## 2026-11-01

### Added
`

describe('parseChangelog', () => {
  const entries = parseChangelog(md)
  it('reads dated entries in file order and groups items', () => {
    expect(entries.map((e) => e.date)).toEqual(['2026-11-07', '2026-11-03'])
    expect(entries[0]!.groups.map((g) => [g.name, g.items.length])).toEqual([['Added', 2], ['Fixed', 1]])
  })
  it('ignores unknown groups and entries with no items', () => {
    expect(JSON.stringify(entries)).not.toContain('ignored')
    expect(entries.some((e) => e.date === '2026-11-01')).toBe(false)
  })
  it('splits inline code', () => {
    expect(inlineParts('Uses `/img` now')).toEqual([{ code: false, text: 'Uses ' }, { code: true, text: '/img' }, { code: false, text: ' now' }])
  })
  it('parses the real CHANGELOG.md with at least one entry', () => {
    const real = parseChangelog(readChangelogFile())
    expect(real.length).toBeGreaterThan(0)
    expect(real.map((e) => e.date)).toEqual([...real.map((e) => e.date)].sort().reverse())
  })
})

describe('changelogFeed', () => {
  const xml = changelogFeed(parseChangelog(md), 'https://blueyvatar.com')
  it('is an Atom feed with one entry per date and anchor links', () => {
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(xml.match(/<entry>/g)).toHaveLength(2)
    expect(xml).toContain('<id>https://blueyvatar.com/changelog#2026-11-07</id>')
    expect(xml).toContain('<updated>2026-11-07T00:00:00Z</updated>')
    expect(xml).toContain('href="https://blueyvatar.com/changelog/feed.xml"')
  })
  it('escapes markup in item text', () => {
    expect(xml).toContain('Uses /img &amp;amp; more')
    expect(xml).not.toContain('<li>Uses')
  })
  it('handles an empty changelog', () => {
    expect(changelogFeed([], 'https://blueyvatar.com')).toContain('<updated>1970-01-01T00:00:00Z</updated>')
  })
})

describe('mergeFragments', () => {
  const base = parseChangelog(md)
  it('adds items to an existing date and group, and a new group when absent', () => {
    const out = mergeFragments(base, [{ date: '2026-11-07', md: '### Added\n- Extra (#9).\n\n### Changed\n- Tweaked (#10).\n' }])
    expect(out[0]!.groups.map((g) => [g.name, g.items.length])).toEqual([['Added', 3], ['Fixed', 1], ['Changed', 1]])
    expect(out[0]!.groups[0]!.items.at(-1)).toBe('Extra (#9).')
  })
  it('creates a missing date in newest-first position', () => {
    const out = mergeFragments(base, [{ date: '2026-11-05', md: '### Fixed\n- Mid (#5).' }, { date: '2026-11-09', md: '### Added\n- Top (#6).' }, { date: '2026-11-01', md: '### Fixed\n- Old (#7).' }])
    expect(out.map((e) => e.date)).toEqual(['2026-11-09', '2026-11-07', '2026-11-05', '2026-11-03', '2026-11-01'])
  })
  it('does not change its input and ignores empty fragments', () => {
    const before = JSON.stringify(base)
    expect(mergeFragments(base, [{ date: '2026-11-07', md: '### Added\n- Z' }])).not.toBe(base)
    expect(JSON.stringify(base)).toBe(before)
    expect(mergeFragments(base, [{ date: '2026-12-01', md: 'no groups' }])).toEqual(base)
  })
  it('reads only dated fragment files, never README.md', () => {
    const files = readChangelogFragments()
    expect(files.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date))).toBe(true)
  })
})
