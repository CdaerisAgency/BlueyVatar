import { expect, test } from '@playwright/test'
import { signIn } from './signed-in'

// The header's account area is filled in by the browser after load. A page restored from the Back/forward cache
// does not run that code again, so it must re-ask when the browser says the page came from the cache (issue 332).
test('header refreshes after sign-out and Back', async ({ page, context }) => {
  await signIn(context)
  await page.goto('/account')
  await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible()

  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.waitForURL((u) => u.pathname === '/')

  await page.goBack()
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible({ timeout: 2000 })
  await expect(page.getByRole('button', { name: /account menu/i })).toHaveCount(0)
})
