import { describe, expect, it } from 'vitest'
import { getDashboardStore } from './dashboard-store'

describe('attribution site on a key (memory store)', () => {
  const key = (hash: string, kind: 'publishable' | 'secret') => ({ kind, label: null, hash, prefix: hash.slice(0, 9), domains: [] as string[] })

  it('stores, clears, and resets the result; rotation keeps the site', async () => {
    const store = getDashboardStore()
    const lic = await store.ensureLicense('did:plc:attr')
    await store.createKey(lic.licenseId, key('pk_aaaaaaaaaa', 'publishable'), () => null)
    expect(await store.setAttributionSite(lic.licenseId, 'pk_aaaaaaaaaa', 'https://site.example/')).toBe(true)
    let k = (await store.listKeys(lic.licenseId))[0]!
    expect(k).toMatchObject({ attributionSite: 'https://site.example/', attributionResult: null, attributionCheckedAt: null })

    await store.createKey(lic.licenseId, { ...key('pk_bbbbbbbbbb', 'publishable'), attributionSite: k.attributionSite }, () => null, 'pk_aaaaaaaaaa')
    const keys = await store.listKeys(lic.licenseId)
    expect(keys.find((x) => x.hash === 'pk_bbbbbbbbbb')!.attributionSite).toBe('https://site.example/')

    expect(await store.setAttributionSite(lic.licenseId, 'pk_bbbbbbbbbb', null)).toBe(true)
    k = (await store.listKeys(lic.licenseId)).find((x) => x.hash === 'pk_bbbbbbbbbb')!
    expect(k.attributionSite).toBeNull()
  })

  it('refuses revoked keys, secret keys, and other licenses', async () => {
    const store = getDashboardStore()
    const lic = await store.ensureLicense('did:plc:attr2')
    await store.createKey(lic.licenseId, key('sk_cccccccccc', 'secret'), () => null)
    await store.createKey(lic.licenseId, key('pk_dddddddddd', 'publishable'), () => null)
    expect(await store.setAttributionSite(lic.licenseId, 'sk_cccccccccc', 'https://s.example/')).toBe(false)
    expect(await store.setAttributionSite('lic_other', 'pk_dddddddddd', 'https://s.example/')).toBe(false)
    await store.revokeKey(lic.licenseId, 'pk_dddddddddd')
    expect(await store.setAttributionSite(lic.licenseId, 'pk_dddddddddd', 'https://s.example/')).toBe(false)
  })
})
