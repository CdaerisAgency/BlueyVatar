import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShareSection } from '../app/account/ShareSection'

/** Phone tap targets (#355): every download link in the account share section keeps the 44 px class from #351. */
describe('ShareSection download links', () => {
  const out = renderToStaticMarkup(
    createElement(ShareSection, { handle: 'bluey', qrUrl: 'https://example.test/p/bluey', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', target: '', platforms: new Map() }),
  )
  const links = out.match(/<a [^>]*download[^>]*>/g) ?? []

  it('renders the SVG, QR PNG and profile download links', () => {
    expect(links.length).toBeGreaterThanOrEqual(3)
  })
  it('gives each one inline-flex min-h-11 items-center', () => {
    for (const a of links) expect(a).toMatch(/class="[^"]*\binline-flex min-h-11 items-center\b/)
  })
})
