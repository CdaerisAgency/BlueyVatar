import { expect, test, type Page } from '@playwright/test'

/** Builds a PNG in the browser: horizontal bands red, green, blue, top to bottom (each a third of the height). */
async function bandedPng(page: Page, w: number, h: number) {
  const b64 = await page.evaluate(
    ([w, h]) => {
      const c = document.createElement('canvas')
      c.width = w!
      c.height = h!
      const ctx = c.getContext('2d')!
      ;['#ff0000', '#00ff00', '#0000ff'].forEach((col, i) => {
        ctx.fillStyle = col
        ctx.fillRect(0, (i * h!) / 3, w!, h! / 3 + 1)
      })
      return c.toDataURL('image/png').split(',')[1]!
    },
    [w, h],
  )
  return { name: `band-${w}x${h}.png`, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }
}

test.describe('upload crop flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e-harness/image-upload')
  })

  test('a portrait image starts at the center crop, blocks upload until applied, and uploads a square', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 400, 600))
    const crop = page.getByRole('group', { name: 'Crop image' })
    await expect(crop).toBeVisible()
    await expect(crop.getByLabel('Zoom')).toBeVisible()

    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('') // native validation holds the form

    await crop.getByRole('button', { name: 'Apply crop' }).click()
    await expect(page.getByText('Cropped to a square')).toBeVisible()
    await page.getByRole('button', { name: 'Submit' }).click()
    // Center crop of 400x600 is y 100..500, so the top-left pixel is red.
    await expect(page.getByTestId('result')).toHaveText('image/png 400x400 under-cap top-left=red')
  })

  test('keyboard moves the crop region and the result follows it', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 400, 600))
    const preview = page.getByTestId('crop-preview')
    await preview.focus()
    for (let i = 0; i < 6; i++) await preview.press('Shift+ArrowDown') // clamps at the bottom edge: y 200..600
    await page.getByRole('button', { name: 'Apply crop' }).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('image/png 400x400 under-cap top-left=green')
  })

  test('labeled buttons move, zoom changes the output size, and reset restores the center crop', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 400, 600))
    await page.getByRole('button', { name: 'Move down' }).click()
    await page.getByRole('button', { name: 'Reset to center crop' }).click()
    await page.getByLabel('Zoom').fill('2')
    await page.getByRole('button', { name: 'Apply crop' }).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('image/png 200x200 under-cap top-left=green')
  })

  test('dragging the preview moves the region', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 400, 600))
    const box = (await page.getByTestId('crop-preview').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 400, { steps: 8 }) // drag up: region moves down
    await page.mouse.up()
    await page.getByRole('button', { name: 'Apply crop' }).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('image/png 400x400 under-cap top-left=green')
  })

  test('a square image skips the crop box', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 300, 300))
    await expect(page.getByRole('group', { name: 'Crop image' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('image/png 300x300 under-cap top-left=red')
  })

  test('an image under 80 pixels shows the existing error', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 60, 200))
    await expect(page.getByRole('alert').filter({ hasText: 'smaller than' })).toHaveText('The image is smaller than 80 by 80 pixels. Choose a larger image.')
    await expect(page.getByRole('group', { name: 'Crop image' })).toHaveCount(0)
  })

  test('zoom cannot go below 80 pixels on the cropped result', async ({ page }) => {
    await page.getByLabel('Image', { exact: true }).setInputFiles(await bandedPng(page, 400, 600))
    await page.getByLabel('Zoom').fill('5') // the largest allowed zoom (400 / 80)
    await page.getByRole('button', { name: 'Apply crop' }).click()
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByTestId('result')).toHaveText('image/png 80x80 under-cap top-left=green')
  })
})
