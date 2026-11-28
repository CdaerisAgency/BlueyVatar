import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDir = join(__dirname, '..', 'app')

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return pages(p)
    return e.name === 'page.tsx' ? [p] : []
  })
}

// A page that reads live admin settings must render per request. With `revalidate` (ISR) Next sends
// `s-maxage=N, stale-while-revalidate=...`: browsers keep the page or its link prefetch and serve it stale, and
// Chromium's background revalidation of a prefetch never reports finished, so a Playwright `networkidle` wait on
// any page linking there hangs (the a11y scan timed out on the second /account load, which prefetches /pricing).
describe('pages that read live settings', () => {
  const readers = pages(appDir).filter((f) => readFileSync(f, 'utf8').includes('getSiteSettings('))

  it('finds the settings readers', () => {
    expect(readers.map((f) => relative(appDir, f).replaceAll('\\', '/'))).toEqual(
      expect.arrayContaining(['pricing/page.tsx', 'gravatar-alternative/page.tsx', 'migrate-from-gravatar/page.tsx']),
    )
  })

  it.each(readers.map((f) => [relative(appDir, f).replaceAll('\\', '/'), f]))(
    '%s is force-dynamic, not ISR',
    (_name, file) => {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/export const revalidate\b/)
      expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
    },
  )
})
