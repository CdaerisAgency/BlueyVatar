import { expect, test } from '@playwright/test'
import { signIn } from './signed-in'

// Smoke tests for the account pages added with effects and the avatar calendar (#316, #321).
// The admin effects page (/admin/effects, #319) has no smoke test here: admin pages sit behind the admin
// TOTP sign-in (lib/admin/session.ts), which these tests do not seed.

test.describe('signed-in account pages', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context)
  })

  test('/account/effects loads for a signed-in account', async ({ page }) => {
    const res = await page.goto('/account/effects')
    expect(res?.status()).toBeLessThan(500)
    await expect(page).toHaveURL(/\/account\/effects$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Effects' })).toBeVisible()
  })

  test('/account/avatars/schedule loads for a signed-in account', async ({ page }) => {
    const res = await page.goto('/account/avatars/schedule')
    expect(res?.status()).toBeLessThan(500)
    await expect(page).toHaveURL(/\/account\/avatars\/schedule$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Avatar calendar' })).toBeVisible()
  })
})
