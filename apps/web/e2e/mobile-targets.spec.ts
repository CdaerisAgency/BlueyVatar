import { expect, test, type Page } from '@playwright/test'
import { SEEDED } from './global-setup'
import { signIn } from './signed-in'

/**
 * Touch targets on phones (WCAG 2.5.5 and 2.5.8). At 390x844 every visible link, button, summary and
 * checkbox row must be at least 44 CSS px tall and at least 24 px wide; the height is the one that was
 * missing before (nav and footer links were 17 to 26 px). Exempt, as WCAG allows: a link inside a
 * sentence (its paragraph has other text), the screen-reader-only skip link, and hidden elements.
 * A checkbox is measured through its wrapping label, since the whole row is the tap target.
 */
const MIN_HEIGHT = 44
const MIN_WIDTH = 24

async function smallTargets(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate(({ minH, minW, scope }) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(['a[href]', 'button', 'summary', 'input[type="checkbox"]'].map((t) => scope.split(',').map((x) => `${x.trim()} ${t}`).join(',')).join(',')))) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.closest('.sr-only, [hidden], details:not([open]) > :not(summary)')) continue
      const label = el instanceof HTMLInputElement ? el.closest('label') : null
      const box = (label ?? el).getBoundingClientRect()
      if (box.width <= 1 || box.height <= 1) continue
      if (el.tagName === 'A') {
        const p = el.closest('p')
        if (p && (p.textContent ?? '').trim() !== (el.textContent ?? '').trim()) continue
      }
      if (box.height < minH - 0.5 || box.width < minW) {
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('name') || '').trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
    }
    return out
  }, { minH: MIN_HEIGHT, minW: MIN_WIDTH, scope })
}

test.describe('touch targets at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const path of ['/', '/pricing', '/docs', `/p/${SEEDED.handle}`]) {
    test(`${path} has no small targets`, async ({ page }) => {
      await page.goto(path)
      await page.locator('footer a').first().waitFor()
      expect(await smallTargets(page)).toEqual([])
    })
  }

  test(`/p/${SEEDED.handle} has no small targets with the QR section open`, async ({ page }) => {
    await page.goto(`/p/${SEEDED.handle}`)
    await page.getByText('QR code', { exact: true }).click()
    expect(await smallTargets(page)).toEqual([])
  })

  test.describe('signed in', () => {
    test.beforeEach(async ({ context }) => {
      await signIn(context)
    })
    test('/account share section download links have no small targets', async ({ page }) => {
      await page.goto('/account')
      await expect(page.getByRole('heading', { name: 'Download your QR code' })).toBeVisible()
      expect(await smallTargets(page)).toEqual([])
    })
    test('bug report toggles have no small targets with the dialog open', async ({ page }) => {
      await page.goto('/account/notifications')
      await page.getByRole('button', { name: /report a bug|unsent report/i }).click()
      await expect(page.getByText('What is sent with this report')).toBeVisible()
      expect(await smallTargets(page, 'dialog')).toEqual([])
    })
    for (const path of ['/account/notifications', '/account/visibility', '/account/settings/danger']) {
      test(`${path} has no small targets`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await smallTargets(page)).toEqual([])
      })
    }
  })
})
