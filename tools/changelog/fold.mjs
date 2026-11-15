// Folds changelog.d/YYYY-MM-DD-*.md into CHANGELOG.md and deletes them. Same merge rule as apps/web/lib/changelog.ts.
// Edits only the touched date sections; everything else in CHANGELOG.md stays byte for byte.
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const dir = join(root, 'changelog.d')
const names = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)).sort()
if (names.length === 0) process.exit(console.log('No fragments to fold.'))
const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n')
const dateAt = (d) => lines.findIndex((l) => l.trim() === `## ${d}`)
const sectionEnd = (i) => { const n = lines.findIndex((l, k) => k > i && /^## /.test(l)); return n === -1 ? lines.length : n }
for (const f of names) {
  const date = f.slice(0, 10)
  const groups = new Map()
  let cur = null
  for (const l of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
    const g = /^### (Added|Changed|Fixed)\s*$/i.exec(l)
    if (g) groups.set((cur = g[1][0].toUpperCase() + g[1].slice(1).toLowerCase()), groups.get(cur) ?? [])
    else if (cur && /^([-*]\s|\s+\S)/.test(l)) groups.get(cur).push(l)
    else if (/^#/.test(l)) cur = null
  }
  for (const [name, items] of groups) {
    if (items.length === 0) continue
    if (dateAt(date) === -1) {
      const at = lines.findIndex((l) => /^## \d{4}-\d{2}-\d{2}\s*$/.test(l) && l.slice(3).trim() < date)
      lines.splice(at === -1 ? lines.length : at, 0, `## ${date}`, '')
      if (at === -1) lines.splice(lines.length - 2, 0, '')
    }
    const start = dateAt(date), end = sectionEnd(start)
    let h = -1
    for (let k = start; k < end; k++) if (lines[k] === `### ${name}`) h = k
    if (h === -1) {
      let at = end
      while (lines[at - 1] === '') at--
      lines.splice(at, 0, '', `### ${name}`, ...items)
    } else {
      let at = sectionEnd(h) > end ? end : h + 1
      while (at < end && !/^###? /.test(lines[at])) at++
      while (lines[at - 1] === '') at--
      lines.splice(at, 0, ...items)
    }
  }
  // keep one blank line before the next date heading
  for (let k = 1; k < lines.length; k++) if (/^## /.test(lines[k]) && lines[k - 1] !== '') lines.splice(k, 0, '')
}
writeFileSync(join(root, 'CHANGELOG.md'), lines.join('\n') + '\n')
for (const f of names) unlinkSync(join(dir, f))
console.log(`Folded ${names.length} fragment(s) into CHANGELOG.md.`)
