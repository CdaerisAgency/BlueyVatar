import { describe, expect, it } from 'vitest'
import { checklist, parsePrefs, profileFilled, serializePrefs, showChecklist, type ChecklistFacts } from './onboarding'

const none: ChecklistFacts = { emailLinked: false, avatarCount: 0, profile: null, visibilitySaved: false, viewedPublicProfile: false }
const all: ChecklistFacts = { emailLinked: true, avatarCount: 2, profile: { jobTitle: 'Engineer', createdAt: 'x' } as never, visibilitySaved: true, viewedPublicProfile: true }

describe('profileFilled', () => {
  it('is false without a record or with only blank fields', () => {
    expect(profileFilled(null)).toBe(false)
    expect(profileFilled({})).toBe(false)
    expect(profileFilled({ jobTitle: '   ', company: '', interests: [' '] })).toBe(false)
  })
  it('is true when any field or interest has text', () => {
    expect(profileFilled({ pronouns: 'she/her' })).toBe(true)
    expect(profileFilled({ interests: ['chess'] })).toBe(true)
  })
})

describe('checklist', () => {
  it('starts with nothing done and points at the first step', () => {
    const c = checklist(none)
    expect(c).toMatchObject({ done: 0, total: 5, complete: false })
    expect(c.next?.id).toBe('email')
  })
  it('computes each step from its own fact', () => {
    const c = checklist({ ...none, avatarCount: 1, visibilitySaved: true })
    expect(c.steps.map((s) => [s.id, s.done])).toEqual([['email', false], ['avatar', true], ['profile', false], ['visibility', true], ['view', false]])
    expect(c.next?.id).toBe('email')
  })
  it('is complete when every step is done', () => {
    const c = checklist(all)
    expect(c).toMatchObject({ done: 5, complete: true, next: null })
  })
  it('does not count the view step until the profile was viewed', () => {
    expect(checklist({ ...all, viewedPublicProfile: false })).toMatchObject({ done: 4, complete: false })
  })
})

describe('showChecklist', () => {
  it('shows while incomplete, hides once complete, and returns on request', () => {
    expect(showChecklist(false, false)).toBe(true)
    expect(showChecklist(false, true)).toBe(true)
    expect(showChecklist(true, false)).toBe(false)
    expect(showChecklist(true, true)).toBe(true)
  })
})

describe('checklist cookie', () => {
  it('round-trips and ignores junk', () => {
    expect(parsePrefs(serializePrefs({ showAgain: true, viewed: true }))).toEqual({ showAgain: true, viewed: true })
    expect(parsePrefs(serializePrefs({ showAgain: false, viewed: true }))).toEqual({ showAgain: false, viewed: true })
    expect(parsePrefs(undefined)).toEqual({ showAgain: false, viewed: false })
    expect(parsePrefs('nonsense,,')).toEqual({ showAgain: false, viewed: false })
  })
})
