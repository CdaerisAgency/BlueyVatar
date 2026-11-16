import { expect, test, type Page } from '@playwright/test'
import { signedInCookie } from './signed-in'

// Phone-width layout checks, run on every page at 320 and 390 px:
//  1. no horizontal page overflow and no visible text under 12 px;
//  2. every <details> and every closed popup/disclosure button is opened one at a time, and nothing it
//     reveals may extend past the viewport (the account menu bug fixed in #349 would fail here).
// Tap target size is checked by its own spec and is deliberately not asserted here.

const PUBLIC = ['/', '/pricing', '/docs', '/integrations', '/gravatar-alternative', '/migrate-from-gravatar', '/changelog', '/privacy', '/policy', '/accessibility', '/login']
// Account pages that render without a query or route parameter (appeal, verify and orgs/[id] need one).
const ACCOUNT = [
  '/account', '/account/profile', '/account/avatars', '/account/avatars/schedule', '/account/avatars/holidays',
  '/account/avatars/import', '/account/billing', '/account/claims', '/account/data', '/account/domain',
  '/account/effects', '/account/keys', '/account/notifications', '/account/orgs', '/account/settings',
  '/account/settings/danger', '/account/stats', '/account/visibility',
]
const VIEWPORTS = [{ width: 320, height: 700 }, { width: 390, height: 844 }]
const MIN_FONT_PX = 12
const BASE = `http://localhost:${process.env.E2E_PORT ?? process.env.E2E_WEB_PORT ?? 3100}`

/** Pages that fail on main for a reason other than the account menu: path -> note. Each is marked test.fixme. */
const KNOWN_BROKEN: Record<string, string> = {}

type Finding = string

/** Horizontal overflow and tiny visible text, measured in the page. */
async function layoutFindings(page: Page, minFont: number): Promise<Finding[]> {
  return page.evaluate((min) => {
    const out: string[] = []
    const de = document.documentElement
    if (de.scrollWidth > window.innerWidth) {
      const wide = [...document.body.querySelectorAll('*')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`)
      out.push(`horizontal overflow: scrollWidth ${de.scrollWidth} > innerWidth ${window.innerWidth} (wide: ${wide.join(', ')})`)
    }
    const seen = new Set<Element>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || seen.has(el) || !n.textContent?.trim()) continue
      seen.add(el)
      if (el.closest('script,style,noscript,template')) continue
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width <= 1 || r.height <= 1 || cs.visibility !== 'visible' || cs.display === 'none' || Number(cs.opacity) === 0) continue
      if (parseFloat(cs.fontSize) < min) out.push(`text under ${min}px (${cs.fontSize}): <${el.tagName.toLowerCase()}> "${n.textContent.trim().slice(0, 40)}"`)
    }
    return out
  }, minFont)
}

/** Marks every currently rendered element so that elements revealed by a click can be told apart. */
async function markPresent(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('[data-mc-pre]').forEach((e) => e.removeAttribute('data-mc-pre'))
    document.body.querySelectorAll('*').forEach((e) => {
      const r = e.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible') e.setAttribute('data-mc-pre', '')
    })
  })
}

/** Elements that became visible since markPresent and stick out past the viewport edges. */
async function revealedOverflow(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const vw = window.innerWidth
    for (const e of document.body.querySelectorAll('*:not([data-mc-pre])')) {
      const r = e.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0 || getComputedStyle(e).visibility !== 'visible') continue
      if (e.closest('script,style,noscript,template')) continue
      if (r.left >= -0.5 && r.right <= vw + 0.5) continue
      // An element inside a scrolling or clipping box (a wide table in overflow-x:auto) is not overflowing the page.
      let clipped = false
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox !== 'visible') { clipped = true; break }
      }
      if (clipped) continue
      out.push(`<${e.tagName.toLowerCase()}> "${(e.textContent ?? '').trim().slice(0, 30)}" left ${Math.round(r.left)} right ${Math.round(r.right)} (viewport ${vw})`)
      if (out.length >= 5) break
    }
    return out
  })
}

/** Tags the openable controls on the page and returns how many details and buttons were found. */
async function tagControls(page: Page): Promise<{ details: number; buttons: number }> {
  return page.evaluate(() => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible'
    }
    document.querySelectorAll('[data-mc]').forEach((e) => e.removeAttribute('data-mc'))
    const details = [...document.querySelectorAll('details > summary')].filter(visible)
    details.forEach((s, i) => s.setAttribute('data-mc', `d${i}`))
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => {
      const popup = b.hasAttribute('aria-haspopup') && b.getAttribute('aria-haspopup') !== 'false'
      if (!popup && b.getAttribute('aria-expanded') !== 'false') return false
      if (b.disabled || !visible(b)) return false
      const type = b.getAttribute('type')
      if (type === 'submit' || (type === null && b.form)) return false
      return true
    })
    buttons.forEach((b, i) => b.setAttribute('data-mc', `b${i}`))
    return { details: details.length, buttons: buttons.length }
  })
}

async function openControlsFindings(page: Page, path: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const { details, buttons } = await tagControls(page)
  const url = page.url()
  for (const id of [...Array.from({ length: details }, (_, i) => `d${i}`), ...Array.from({ length: buttons }, (_, i) => `b${i}`)]) {
    const control = page.locator(`[data-mc="${id}"]`)
    if ((await control.count()) === 0) continue
    const label = (await control.first().getAttribute('aria-label')) || ((await control.first().textContent()) ?? '').trim().slice(0, 30) || id
    await markPresent(page)
    await control.first().click({ timeout: 3000 })
    await page.waitForTimeout(150)
    if (page.url() !== url) {
      // The control navigated; it is not a popup. Go back and carry on.
      await page.goto(path)
      await tagControls(page)
      continue
    }
    for (const f of await revealedOverflow(page)) findings.push(`${path} control "${label}": ${f}`)
    // Close it again with Escape. A control Escape does not close (an off-canvas drawer covers its own button)
    // is reset by reloading the page, so the next control starts from a clean state.
    await page.keyboard.press('Escape')
    const stillOpen = await control.first().evaluate((el) =>
      el.getAttribute('aria-expanded') === 'true' || (el.tagName === 'SUMMARY' && (el.parentElement as HTMLDetailsElement).open),
    )
    if (stillOpen) {
      await page.goto(path, { waitUntil: 'load' })
      await tagControls(page)
    }
  }
  return findings
}

for (const viewport of VIEWPORTS) {
  const groups: Array<{ name: string; paths: string[]; signedIn: boolean }> = [
    { name: 'public', paths: PUBLIC, signedIn: false },
    { name: 'account', paths: ACCOUNT, signedIn: true },
  ]
  for (const group of groups) {
    test.describe(`${group.name} pages at ${viewport.width}px`, () => {
      let page: Page
      test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext({ viewport, baseURL: BASE })
        if (group.signedIn) await context.addCookies([{ name: 'bv_session', value: signedInCookie(), url: BASE, httpOnly: true }])
        page = await context.newPage()
      })
      test.afterAll(async () => {
        await page.context().close()
      })

      for (const path of group.paths) {
        const broken = KNOWN_BROKEN[path]
        const define = broken ? test.fixme : test
        define(`${path} fits the screen and has readable text`, async () => {
          const res = await page.goto(path, { waitUntil: 'load' })
          expect(res?.status()).toBeLessThan(500)
          if (group.signedIn) expect(new URL(page.url()).pathname).toMatch(/^\/account/)
          expect(await layoutFindings(page, MIN_FONT_PX)).toEqual([])
        })
        define(`${path} popups and disclosures stay on screen when opened`, async () => {
          await page.goto(path, { waitUntil: 'load' })
          expect(await openControlsFindings(page, path)).toEqual([])
        })
      }
    })
  }
}
