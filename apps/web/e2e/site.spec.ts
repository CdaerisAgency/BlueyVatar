import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { SEEDED } from './global-setup'

test.describe('public pages', () => {
  test('landing page renders', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your face, carried by your own account.')
  })

  test('pricing page renders', async ({ page }) => {
    const res = await page.goto('/pricing')
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page).toHaveTitle(/Pricing/)
  })

  test('login page renders and rejects a malformed handle', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await page.getByLabel(/handle/i).fill('not a handle')
    await page.getByRole('button', { name: /sign in|continue|log in/i }).click()
    // The message appears twice on purpose: in the error summary link and under the field.
    await expect(page.locator('#login-handle-error')).toContainText('Enter a valid handle')
    await expect(page.getByLabel(/handle/i)).toHaveAttribute('aria-describedby', /login-help/)
  })

  test('unknown paths show the 404 page', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist')
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })
})

test.describe('profile page', () => {
  test('renders a seeded profile', async ({ page }) => {
    const res = await page.goto(`/p/${SEEDED.handle}`)
    expect(res?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SEEDED.displayName)
    await expect(page.getByText(SEEDED.description)).toBeVisible()
    await expect(page.getByText('Lisbon')).toBeVisible()
  })

  test('an unknown handle says so', async ({ page }) => {
    await page.goto('/p/nobody.test')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile not found')
  })
})

// Every route under /account that renders a page sends a signed-out visitor to /login.
const ACCOUNT_ROUTES = [
  '/account',
  '/account/avatars',
  '/account/avatars/import',
  '/account/billing',
  '/account/claims',
  '/account/domain',
  '/account/keys',
  '/account/notifications',
  '/account/profile',
  '/account/verify',
  '/account/visibility',
]

test.describe('signed-out redirects', () => {
  for (const route of ACCOUNT_ROUTES) {
    test(`${route} redirects to /login`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login(\?next=.*)?$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    })
  }
})

test.describe('report form', () => {
  test('a signed-out visitor sees a sign-in prompt and a contact address, not the form', async ({ page }) => {
    await page.goto(`/p/${SEEDED.handle}`)
    await page.getByText('Report this profile', { exact: true }).click()
    await expect(page.getByRole('link', { name: 'Sign in with Bluesky to report this profile' })).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/p/${SEEDED.handle}`)}`)
    await expect(page.getByRole('link', { name: 'security@blueyvatar.com' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send report' })).toHaveCount(0)
  })
})
