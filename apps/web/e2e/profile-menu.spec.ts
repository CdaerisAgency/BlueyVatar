import { expect, test } from '@playwright/test'
import { signIn } from './signed-in'

// The header wraps on a phone, which can put the account button near the left edge. The menu must stay on screen.
for (const width of [320, 390, 1280]) {
  test(`account menu stays inside a ${width} px viewport`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 })
    await signIn(context)
    await page.goto('/')
    await page.getByRole('button', { name: /account menu/i }).click()
    const panel = page.getByRole('link', { name: 'Your account' }).locator('xpath=..')
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  })
}
