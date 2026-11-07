// Runs axe-core (WCAG 2.2 AA tags) against public pages and every /account/* page with a seeded session.
// Fails on any violation. Build first: `pnpm --filter @blueyvatar/web build`, then `pnpm --filter @blueyvatar/web a11y`.
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { DID, sessionCookie, startDelivery, startWeb } from './server.mjs'

const WEB_PORT = Number(process.env.A11Y_PORT ?? 3917)
const DELIVERY_PORT = WEB_PORT + 1
const base = `http://localhost:${WEB_PORT}`

const PUBLIC = ['/', '/pricing', '/login', '/login?error=Handle%20not%20found', '/p/alice.example.com', '/p/alice.example.com?report=invalid', '/policy', '/privacy', '/accessibility']
const ACCOUNT = ['/account', '/account/profile', '/account/avatars', '/account/billing', '/account/claims', '/account/domain', '/account/keys', '/account/notifications', '/account/visibility']
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const delivery = await startDelivery(DELIVERY_PORT)
const web = await startWeb(WEB_PORT, DELIVERY_PORT)
const browser = await chromium.launch()
let failed = 0
try {
  const context = await browser.newContext()
  const anon = await context.newPage()
  await context.addCookies([{ name: 'bv_session', value: sessionCookie(), url: base, httpOnly: true }])
  for (const path of [...PUBLIC, ...ACCOUNT]) {
    const page = await context.newPage()
    const res = await page.goto(base + path, { waitUntil: 'networkidle' })
    if (!res || res.status() >= 500) {
      console.error(`FAIL ${path}: HTTP ${res?.status()}`)
      failed++
      await page.close()
      continue
    }
    // The report form sits in a closed <details>; open it so its fields are scanned.
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)))
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    const where = new URL(page.url()).pathname
    if (violations.length) {
      failed += violations.length
      for (const v of violations) console.error(`FAIL ${path} (landed ${where}): ${v.id} [${v.impact}] ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    } else console.log(`ok   ${path} (landed ${where})`)
    await page.close()
  }
  // Skip link: the first Tab stop on every page, and it moves focus to <main id="main">.
  for (const path of ['/', '/pricing', '/login', '/privacy']) {
    await anon.goto(base + path)
    await anon.keyboard.press('Tab')
    const first = await anon.evaluate(() => document.activeElement?.textContent?.trim())
    await anon.keyboard.press('Enter')
    const landed = await anon.evaluate(() => document.activeElement?.id)
    if (first !== 'Skip to main content' || landed !== 'main') {
      console.error(`FAIL ${path}: skip link (first stop "${first}", focus landed on "${landed}")`)
      failed++
    } else console.log(`ok   ${path} skip link`)
  }
  await anon.close()
  console.log(`seeded session: ${DID}`)
} finally {
  await browser.close()
  process.kill(-web.pid)
  delivery.close()
}
if (failed) {
  console.error(`${failed} accessibility violation(s)`)
  process.exit(1)
}
