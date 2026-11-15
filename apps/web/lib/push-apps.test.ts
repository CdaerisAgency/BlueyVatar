import { describe, expect, it } from 'vitest'
import { PUSH_APPS, limitLabel, pushApp } from './push-apps'
import { grantsProfileWrite, profileWriteScope } from './oauth'

/** One entry per app. These checks catch a half-filled entry before it reaches the page (see the header of push-apps.ts). */
describe('PUSH_APPS', () => {
  it('lists Bluesky first and Tangled second', () => {
    expect(PUSH_APPS.map((a) => a.id)).toEqual(['bluesky', 'tangled'])
    expect(pushApp('tangled')?.collection).toBe('org.tangled.actor.profile')
    expect(pushApp('nope')).toBeUndefined()
  })

  it.each(PUSH_APPS.map((a) => [a.id, a] as const))('%s has every field, filled in from a published lexicon', (_id, a) => {
    expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(a.name.length).toBeGreaterThan(0)
    expect(a.collection).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*){2,}$/)
    expect(a.url).toMatch(/^https:\/\//)
    expect(a.source).toMatch(/^https:\/\/.+\.json$/)
    expect(a.avatar.maxBytes).toBeGreaterThan(0)
    expect(a.avatar.mimes.length).toBeGreaterThan(0)
    expect(a.reach.length).toBeGreaterThan(10)
  })

  it('has unique ids and collections', () => {
    expect(new Set(PUSH_APPS.map((a) => a.id)).size).toBe(PUSH_APPS.length)
    expect(new Set(PUSH_APPS.map((a) => a.collection)).size).toBe(PUSH_APPS.length)
  })

  it('derives each permission from the collection: create and update on that one collection', () => {
    for (const a of PUSH_APPS) {
      const scope = profileWriteScope(a.collection)
      expect(grantsProfileWrite(a.collection, `atproto ${scope}`)).toBe(true)
      for (const other of PUSH_APPS.filter((o) => o.id !== a.id)) expect(grantsProfileWrite(other.collection, `atproto ${scope}`)).toBe(false)
    }
  })

  it('writes limits the way the lexicons count them', () => {
    expect(limitLabel(1_000_000)).toBe('1 MB')
    expect(limitLabel(500_000)).toBe('500 KB')
  })
})
