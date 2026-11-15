import { expect, test, type Page } from '@playwright/test'

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function mockAvailability(page: Page, state: { available: boolean; signedIn: boolean }) {
  await page.route('**/api/bug-report', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state })
    return route.fallback()
  })
}

test.describe('bug report button', () => {
  test('is hidden when reports are unavailable', async ({ page }) => {
    await mockAvailability(page, { available: false, signedIn: true })
    await page.goto('/pricing')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Report a bug' })).toHaveCount(0)
  })

  test('asks a signed-out visitor to sign in', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: false })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a bug' })
    await expect(dialog.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
    await expect(dialog.getByLabel('What went wrong?')).toHaveCount(0)
  })

  test('traps focus, closes on Escape, and returns focus to the button', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: true })
    await page.goto('/pricing')
    const opener = page.getByRole('button', { name: 'Report a bug' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Report a bug' })
    await expect(dialog).toBeVisible()
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => document.activeElement?.closest('dialog') !== null)).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('keeps an unsent draft after the dialog closes', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: true })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    await page.getByLabel('What went wrong?').fill('The pricing table is cut off on my phone.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Unsent report' }).click()
    await expect(page.getByLabel('What went wrong?')).toHaveValue('The pricing table is cut off on my phone.')
  })

  test('previews an attached picture and removes it', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: true })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    await page.getByLabel('Choose a screenshot file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('img', { name: 'Preview of your screenshot' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove screenshot' }).click()
    await expect(page.getByRole('img', { name: 'Preview of your screenshot' })).toHaveCount(0)
    await page.getByLabel('Choose a screenshot file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await expect(page.getByRole('alert').filter({ hasText: 'PNG, JPEG, or WebP' })).toBeVisible()
  })

  test('sends the report with the screenshot and shows the issue link', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: true })
    let posted: Record<string, unknown> | null = null
    await page.route('**/api/bug-report', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      posted = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { ok: true, number: 12, url: 'https://github.com/example/repo/issues/12' } })
    })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    await page.getByLabel('Choose a screenshot file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })
    await page.getByLabel('What went wrong?').fill('The pricing table is cut off on my phone.')
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByRole('status')).toContainText('Your report was sent')
    expect(posted).toMatchObject({ includeHandle: false, hasScreenshot: true, page: '/pricing', website: '' })
    const sentShot = (posted as { screenshot?: unknown } | null)?.screenshot
    expect(typeof sentShot === 'string' && sentShot.length > 0).toBe(true)
    expect(String(sentShot)).not.toContain('data:')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Report a bug' })).toBeFocused()
  })

  test('shows the server message when the limit is hit', async ({ page }) => {
    await mockAvailability(page, { available: true, signedIn: true })
    await page.route('**/api/bug-report', async (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 429, json: { ok: false, error: 'Too many requests. Try again in 1 hour.' } }) : route.fallback()))
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    await page.getByLabel('What went wrong?').fill('The pricing table is cut off on my phone.')
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Too many requests')
  })

  test('fits a phone screen and honors reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 320, height: 568 })
    await mockAvailability(page, { available: true, signedIn: true })
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Report a bug' }).click()
    const box = await page.getByRole('dialog', { name: 'Report a bug' }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(320)
    expect(box!.y + box!.height).toBeLessThanOrEqual(568)
    await expect(page.getByRole('button', { name: 'Send report' })).toBeAttached()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
