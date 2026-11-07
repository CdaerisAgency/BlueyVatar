// Keyboard behavior of hovercards in a real browser: focus opens the card, Escape closes it, focus is never trapped.
// Needs public/embed/hovercard.js (`node scripts/build-embed.mjs`).
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { webRoot } from './server.mjs'

const script = readFileSync(`${webRoot}public/embed/hovercard.js`, 'utf8')
const profile = { handle: 'alice.example.com', displayName: 'Alice Example', jobTitle: 'Engineer' }

const browser = await chromium.launch()
const checks = []
const check = (name, ok) => {
  checks.push([name, ok])
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
}
try {
  const page = await browser.newPage()
  const html = `<!doctype html><html lang="en"><head><title>Hovercards</title></head><body>
    <button id="before">Before</button>
    <img id="av" data-blueyvatar="alice.example.com" alt="Alice" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
    <button id="after">After</button>
    <script data-key="pk_test" src="https://blueyvatar.test/embed/hovercard.js"></script></body></html>`
  await page.route('https://blueyvatar.test/**', (route) => {
    const url = route.request().url()
    if (url.includes('/profile/')) return route.fulfill({ json: profile })
    if (url.endsWith('/embed/hovercard.js')) return route.fulfill({ contentType: 'text/javascript', body: script })
    return route.fulfill({ contentType: 'text/html', body: html })
  })
  await page.goto('https://blueyvatar.test/')
  const card = page.locator('[role="group"][aria-label="Alice Example"]')

  const img = page.locator('#av')
  check('image is reachable by keyboard (tabindex)', (await img.getAttribute('tabindex')) !== null)
  await page.focus('#before')
  await page.keyboard.press('Tab')
  check('Tab lands on the avatar', await page.evaluate(() => document.activeElement?.id === 'av'))
  await card.waitFor({ timeout: 5000 }).catch(() => {})
  check('focus opens the card', (await card.count()) === 1)
  check('avatar is described by the card', (await img.getAttribute('aria-describedby')) === (await card.getAttribute('id')))

  await page.keyboard.press('Escape')
  check('Escape closes the card', (await card.count()) === 0)
  check('Escape keeps focus on the avatar', await page.evaluate(() => document.activeElement?.id === 'av'))

  // No focus trap: Tab moves on, and the card closes with it.
  await img.focus()
  await card.waitFor({ timeout: 5000 }).catch(() => {})
  await page.keyboard.press('Tab')
  check('Tab leaves the avatar', await page.evaluate(() => document.activeElement?.id === 'after'))
  await page.waitForTimeout(300)
  check('card closes when focus moves on', (await card.count()) === 0)
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  check('Shift+Tab moves backward past the avatar', await page.evaluate(() => document.activeElement?.id === 'before'))
} finally {
  await browser.close()
}
if (checks.some(([, ok]) => !ok)) process.exit(1)
