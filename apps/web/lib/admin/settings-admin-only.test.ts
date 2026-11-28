import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  listSettingRows: vi.fn(), getAssetMeta: vi.fn(), saveSettings: vi.fn(), resetSetting: vi.fn(), putOverLimitAsset: vi.fn(), removeOverLimitAsset: vi.fn(),
}))
const limited = vi.hoisted(() => vi.fn(async () => null))
const query = vi.hoisted(() => vi.fn())

// The guard answers a non-admin the way Next does: notFound() throws.
vi.mock('./guard', () => ({ requireAdmin: vi.fn(async () => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('./site-settings', async (orig) => ({ ...(await orig<typeof import('./site-settings')>()), ...store }))
vi.mock('../rate-guard', () => ({ limited }))
vi.mock('../store', () => ({ getPool: () => ({ query }) }))
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`NEXT_REDIRECT ${u}`) }, notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))

describe('settings page is admin-only', () => {
  beforeEach(() => vi.clearAllMocks())

  it('the four actions refuse a non-admin before touching the store or the rate guard', async () => {
    const actions = await import('../../app/admin/settings/actions')
    const form = new FormData()
    form.set('key', 'limits.anonymousDaily')
    form.set('limits.anonymousDaily', '500')
    form.set('image', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }))
    await expect(actions.saveSettingsAction(null, form)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(actions.resetSettingAction(form)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(actions.uploadOverLimitAction(form)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(actions.removeOverLimitAction()).rejects.toThrow('NEXT_NOT_FOUND')
    for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled()
    expect(limited).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('the preview route refuses a non-admin and reads nothing', async () => {
    const { GET } = await import('../../app/admin/settings/over-limit/route')
    await expect(GET()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(query).not.toHaveBeenCalled()
  })

  it('the page refuses a non-admin and reads nothing', async () => {
    const page = (await import('../../app/admin/settings/page')).default
    await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(store.listSettingRows).not.toHaveBeenCalled()
    expect(store.getAssetMeta).not.toHaveBeenCalled()
  })

  it('Enter in a number field saves: Save is the form\'s only submit button, and every Reset belongs to the separate reset form', () => {
    const src = readFileSync(new URL('../../app/admin/settings/SettingsForm.tsx', import.meta.url), 'utf8')
    const buttons = src.match(/<(?:button|Button)\b[^>]*type="submit"[^>]*>/g) ?? []
    const own = buttons.filter((b) => !/form=\{RESET_FORM\}/.test(b))
    expect(own).toHaveLength(1)
    expect(own[0]).toMatch(/^<Button/)
    expect(buttons.length).toBeGreaterThan(1)
    expect(readFileSync(new URL('../../app/admin/settings/page.tsx', import.meta.url), 'utf8')).toMatch(/<form id="reset-form" action=\{resetSettingAction\}/)
  })
})
