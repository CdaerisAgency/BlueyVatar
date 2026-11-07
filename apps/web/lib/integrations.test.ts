import { describe, expect, it } from 'vitest'
import { signInEntries } from './integrations'

describe('integrations sign-in list', () => {
  it('marks flag-off platforms as not live and keeps GitHub and Mastodon live', () => {
    const e = signInEntries({})
    expect(e.find((x) => x.platform === 'github')?.live).toBe(true)
    expect(e.find((x) => x.platform === 'mastodon')?.live).toBe(true)
    for (const p of ['twitch', 'youtube', 'instagram', 'threads', 'tiktok']) expect(e.find((x) => x.platform === p)?.live).toBe(false)
  })
  it('turns a platform on only with the flag and both credentials', () => {
    const on = { VERIFY_TWITCH_ENABLED: 'true', TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' }
    expect(signInEntries(on).find((x) => x.platform === 'twitch')?.live).toBe(true)
    expect(signInEntries({ VERIFY_TWITCH_ENABLED: 'true' }).find((x) => x.platform === 'twitch')?.live).toBe(false)
    expect(signInEntries({ VERIFY_INSTAGRAM_ENABLED: 'true', INSTAGRAM_APP_ID: 'a', INSTAGRAM_APP_SECRET: 'b' }).find((x) => x.platform === 'instagram')?.live).toBe(true)
  })
})
