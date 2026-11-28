import { beforeEach, describe, expect, it, vi } from 'vitest'

const restore = vi.fn()
vi.mock('./auth', () => ({ oauthClient: async () => ({ restore }) }))
const warn = vi.fn()
vi.mock('./obs', () => ({ log: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() } }))

import { COPY } from './copy'
import { OAuthLockUnavailableError } from './oauth-lock'
import { RepoError, SessionExpiredError, repoSession, xrpc } from './repo'

describe('repoSession', () => {
  beforeEach(() => {
    restore.mockReset()
    warn.mockReset()
  })

  it('throws SessionExpiredError when restore rejects', async () => {
    restore.mockRejectedValue(new Error('gone'))
    const err = await repoSession('did:plc:x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SessionExpiredError)
    expect(err).toBeInstanceOf(RepoError)
    expect((err as Error).message).toBe(COPY.session.expired)
  })

  it('logs the restore cause and keeps tokens out', async () => {
    restore.mockRejectedValue(new Error('refresh failed token=abc'))
    await repoSession('did:plc:x').catch(() => {})
    expect(warn).toHaveBeenCalledTimes(1)
    const [msg, ctx] = warn.mock.calls[0] as [string, Record<string, unknown>]
    expect(msg).toBe('oauth restore failed')
    expect(ctx.did).toBe('did:plc:x')
    expect(ctx.errorName).toBe('Error')
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('token=abc')
  })

  it('maps a lock that cannot be had to the busy message, not an expired session', async () => {
    restore.mockRejectedValue(new Error('wrapped', { cause: new OAuthLockUnavailableError('lock', new Error('lock timeout')) }))
    const err = await repoSession('did:plc:x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepoError)
    expect(err).not.toBeInstanceOf(SessionExpiredError)
    expect((err as Error).message).toBe(COPY.session.busy)
    expect(warn).toHaveBeenCalledWith('oauth lock unavailable', { did: 'did:plc:x' })
  })

  it('logs the class name, cause class, status and OAuth code, never the message', async () => {
    class TokenRefreshError extends Error {}
    class OAuthResponseError extends Error {
      status = 400
      error = 'invalid_grant'
      errorDescription = 'refresh token secret=zzz'
    }
    restore.mockRejectedValue(new TokenRefreshError('refresh token=abc', { cause: new OAuthResponseError('bad') }))
    await repoSession('did:plc:x').catch(() => {})
    const [, ctx] = warn.mock.calls[0] as [string, Record<string, unknown>]
    expect(ctx).toMatchObject({ did: 'did:plc:x', errorName: 'TokenRefreshError', causeName: 'OAuthResponseError', status: 400, error: 'invalid_grant' })
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/token=abc|secret=zzz/)
  })

  it('maps a lock failure inside an authenticated request to the busy message', async () => {
    const session = { fetchHandler: vi.fn().mockRejectedValue(new Error('x', { cause: new OAuthLockUnavailableError('connect', new Error('t')) })) }
    const err = await xrpc(session as never, 'GET', 'com.atproto.repo.listRecords').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepoError)
    expect((err as Error).message).toBe(COPY.session.busy)
  })
})
