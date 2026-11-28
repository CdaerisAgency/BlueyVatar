import { beforeEach, describe, expect, it, vi } from 'vitest'

const restore = vi.fn()
vi.mock('./auth', () => ({ oauthClient: async () => ({ restore }) }))
const warn = vi.fn()
vi.mock('./obs', () => ({ log: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() } }))

import { COPY } from './copy'
import { RepoError, SessionExpiredError, repoSession } from './repo'

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
})
