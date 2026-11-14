import { describe, expect, it } from 'vitest'
import { PERMISSION_SET_NSID, clientMetadata, consentScope, declaredScope, emailLinkScope, grantsProfileWrite, profileWriteScope, pushAppsEnabled, signInScope, usePermissionSet } from './oauth'
import { PUSH_APPS } from './push-apps'

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

describe('profile scope per app', () => {
  it('asks for create and update on one collection (issue #297)', () => {
    expect(profileWriteScope('app.bsky.actor.profile')).toBe('repo:app.bsky.actor.profile?action=create&action=update')
    expect(profileWriteScope('org.tangled.actor.profile')).toBe('repo:org.tangled.actor.profile?action=create&action=update')
  })

  it('leaves the normal sign-in request without any app profile scope', () => {
    for (const set of [false, true]) {
      expect(signInScope(set)).not.toContain('app.bsky')
      expect(signInScope(set)).not.toContain('tangled')
      expect(emailLinkScope(set)).not.toContain('actor.profile')
    }
    expect(signInScope(false)).toBe('atproto repo:com.blueyvatar.image repo:com.blueyvatar.profile repo:com.blueyvatar.claim blob:image/*')
  })

  it('adds only the listed apps to a consent request, once each, after the sign-in scope', () => {
    expect(consentScope(['app.bsky.actor.profile'], false)).toBe(`${signInScope(false)} repo:app.bsky.actor.profile?action=create&action=update`)
    expect(consentScope(['app.bsky.actor.profile', 'org.tangled.actor.profile', 'app.bsky.actor.profile'], false)).toBe(
      `${signInScope(false)} repo:app.bsky.actor.profile?action=create&action=update repo:org.tangled.actor.profile?action=create&action=update`,
    )
    expect(consentScope(['org.tangled.actor.profile'], false)).not.toContain('app.bsky')
  })

  it('is off by default and declares the registry scopes in the client metadata only when on', () => {
    for (const v of ['', 'false', '0', 'yes', undefined]) expect(pushAppsEnabled({ OAUTH_PUSH_APPS: v })).toBe(false)
    for (const v of ['true', 'TRUE', '1', ' true ']) expect(pushAppsEnabled({ OAUTH_PUSH_APPS: v })).toBe(true)
    const collections = PUSH_APPS.map((a) => a.collection)
    expect(declaredScope(collections, false, false)).toBe(emailLinkScope(false))
    const on = declaredScope(collections, false, true).split(' ')
    for (const c of collections) expect(on).toContain(profileWriteScope(c))
    expect(on).toContain('account:email')
  })

  it('reads a granted scope string: both create and update are needed', () => {
    const c = 'app.bsky.actor.profile'
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profile?action=create&action=update blob:image/*')).toBe(true)
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profile')).toBe(true)
    expect(grantsProfileWrite(c, 'atproto repo:*')).toBe(true)
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profile?action=update')).toBe(false)
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profile?action=create')).toBe(false)
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profile?action=delete')).toBe(false)
    expect(grantsProfileWrite(c, 'atproto repo:app.bsky.actor.profileX blob:image/*')).toBe(false)
    expect(grantsProfileWrite(c, 'atproto repo:com.blueyvatar.image')).toBe(false)
    expect(grantsProfileWrite(c, undefined)).toBe(false)
    expect(grantsProfileWrite('org.tangled.actor.profile', 'atproto repo:app.bsky.actor.profile?action=create&action=update')).toBe(false)
  })
})
