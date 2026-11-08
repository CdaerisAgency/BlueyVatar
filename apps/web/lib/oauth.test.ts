import { describe, expect, it } from 'vitest'
import { PERMISSION_SET_NSID, clientMetadata, emailLinkScope, grantsBskyProfileUpdate, signInScope, useBskyProfileScope, usePermissionSet } from './oauth'

describe('OAuth scope', () => {
  it('defaults to the three granular repo scopes', () => {
    expect(usePermissionSet({})).toBe(false)
    expect(signInScope(false)).toBe('atproto repo:com.blueyvatar.image repo:com.blueyvatar.profile repo:com.blueyvatar.claim blob:image/*')
    expect(emailLinkScope(false)).toBe(`${signInScope(false)} account:email`)
  })

  it('switches to the include: scope behind OAUTH_USE_PERMISSION_SET', () => {
    for (const v of ['true', 'TRUE', '1', ' true ']) expect(usePermissionSet({ OAUTH_USE_PERMISSION_SET: v })).toBe(true)
    for (const v of ['', 'false', '0', 'yes', undefined]) expect(usePermissionSet({ OAUTH_USE_PERMISSION_SET: v })).toBe(false)
    expect(PERMISSION_SET_NSID).toBe('com.blueyvatar.authFull')
    expect(signInScope(true)).toBe('atproto include:com.blueyvatar.authFull blob:image/*')
  })

  it('keeps blob and account scopes outside the set', () => {
    const scopes = emailLinkScope(true).split(' ')
    expect(scopes).toContain('blob:image/*')
    expect(scopes).toContain('account:email')
    expect(scopes.some((s) => s.startsWith('repo:'))).toBe(false)
  })

  it('declares the active scope in the client metadata', () => {
    const saved = process.env.OAUTH_USE_PERMISSION_SET
    try {
      delete process.env.OAUTH_USE_PERMISSION_SET
      expect(clientMetadata().scope).toBe(emailLinkScope(false))
      process.env.OAUTH_USE_PERMISSION_SET = 'true'
      expect(clientMetadata().scope).toBe('atproto include:com.blueyvatar.authFull blob:image/* account:email')
    } finally {
      if (saved === undefined) delete process.env.OAUTH_USE_PERMISSION_SET
      else process.env.OAUTH_USE_PERMISSION_SET = saved
    }
  })
})

describe('Bluesky profile scope', () => {
  it('is off by default and adds one update-only scope when on', () => {
    for (const v of ['', 'false', '0', 'yes', undefined]) expect(useBskyProfileScope({ OAUTH_REQUEST_BSKY_PROFILE: v })).toBe(false)
    for (const v of ['true', 'TRUE', '1', ' true ']) expect(useBskyProfileScope({ OAUTH_REQUEST_BSKY_PROFILE: v })).toBe(true)
    expect(signInScope(false, false)).not.toContain('app.bsky')
    expect(signInScope(false, true)).toBe('atproto repo:com.blueyvatar.image repo:com.blueyvatar.profile repo:com.blueyvatar.claim repo:app.bsky.actor.profile?action=update blob:image/*')
    expect(signInScope(true, true)).toContain('repo:app.bsky.actor.profile?action=update')
    expect(emailLinkScope(false, true)).toBe(`${signInScope(false, true)} account:email`)
  })

  it('reads a granted scope string', () => {
    expect(grantsBskyProfileUpdate('atproto repo:app.bsky.actor.profile?action=update blob:image/*')).toBe(true)
    expect(grantsBskyProfileUpdate('atproto repo:app.bsky.actor.profile')).toBe(true)
    expect(grantsBskyProfileUpdate('atproto repo:app.bsky.actor.profile?action=create&action=update')).toBe(true)
    expect(grantsBskyProfileUpdate('atproto repo:app.bsky.actor.profile?action=create')).toBe(false)
    expect(grantsBskyProfileUpdate('atproto repo:app.bsky.actor.profileX blob:image/*')).toBe(false)
    expect(grantsBskyProfileUpdate('atproto repo:com.blueyvatar.image')).toBe(false)
    expect(grantsBskyProfileUpdate(undefined)).toBe(false)
  })
})
