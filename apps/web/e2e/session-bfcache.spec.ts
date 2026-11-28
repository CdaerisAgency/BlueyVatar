import { expect, test } from '@playwright/test'
import { signIn } from './signed-in'

// Playwright starts Chromium with --disable-back-forward-cache. Turn it back on here, because the point of this test is
// a page restored from that cache, which does not run the header's load code again (issue 332).
test.use({
  launchOptions: {
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  },
})

test('header refreshes after sign-out and Back', async ({ page, context }) => {
  await signIn(context)
  // /pricing is static and cacheable, so the browser can keep it in the Back/forward cache. /account cannot be kept.
  await page.goto('/pricing')
  await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible()
  // The marker lives only in the page's memory. It survives Back only when the page came from the cache.
  await page.evaluate(() => {
    ;(window as unknown as { __bf: number }).__bf = 1
  })

  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.waitForURL((u) => u.pathname === '/')

  await page.goBack()
  await expect(page).toHaveURL(/\/pricing$/)
  // Guard: without this the test degrades to a plain reload test and passes without the fix.
  expect(await page.evaluate(() => (window as unknown as { __bf?: number }).__bf)).toBe(1)
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible({ timeout: 2000 })
  await expect(page.getByRole('button', { name: /account menu/i })).toHaveCount(0)
})
