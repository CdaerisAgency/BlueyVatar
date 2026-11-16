import { SEEDED } from './global-setup'
import { expect, test, type Page } from '@playwright/test'

/** Collects console errors and uncaught page errors, which is where React reports a hydration mismatch. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

test.describe('no console errors', () => {
  test('/changelog logs nothing', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/changelog', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changelog')
    expect(errors).toEqual([])
  })

  // On staging, Cloudflare's email obfuscation rewrites every address in the served HTML into a "[email protected]"
  // link. React then fails to hydrate the changelog (minified error #418). This test serves the page the way the proxy does.
  test('/changelog hydrates when a proxy obfuscates email addresses in the HTML', async ({ page }) => {
    const errors = watchErrors(page)
    await page.route('**/changelog', async (route) => {
      const res = await route.fetch()
      const html = (await res.text())
        .split(/(<script[\s\S]*?<\/script>)/)
        .map((part) =>
          part.startsWith('<script')
            ? part
            : part.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="00">[email&#160;protected]</a>'),
        )
        .join('')
      await route.fulfill({ response: res, body: html })
    })
    await page.goto('/changelog', { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Changelog')
    expect(errors).toEqual([])
  })
})

test('a profile page has a title with the display name and the site name', async ({ page }) => {
  await page.goto(`/p/${SEEDED.handle}`)
  await expect(page).toHaveTitle(`${SEEDED.displayName} | BlueyVatar`)
})
