import { describe, expect, it, vi } from 'vitest'
import { interestStats, runProfileSave, type SaveDeps } from './profile-form'
import { INTERESTS_BOX_MAX_LENGTH, MAX_INTERESTS, validateProfileAll } from './records'

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}
const deps = (over: Partial<SaveDeps> = {}): SaveDeps => ({
  limited: async () => null,
  save: vi.fn(async () => {}),
  report: () => {},
  messageFor: (e) => (e instanceof Error ? e.message : 'x'),
  lowContrast: () => false,
  ...over,
})
const typed = { jobTitle: 'Dev', company: 'Acme', location: 'Berlin', pronouns: 'they/them', pronunciation: 'Bloo-ee', interests: 'chess, go' }

describe('profile form keeps input', () => {
  it('one invalid field leaves the other values in the result', async () => {
    const d = deps()
    const r = await runProfileSave('did:plc:a', form({ ...typed, timezone: 'Mars/Olympus' }), d)
    expect(r.errors).toEqual({ timezone: expect.any(String) })
    expect(r.values).toMatchObject(typed)
    expect(r.values?.timezone).toBe('Mars/Olympus')
    expect(d.save).not.toHaveBeenCalled()
  })
  it('reports every invalid field at once', async () => {
    const r = await runProfileSave('did:plc:a', form({ ...typed, timezone: 'Nope', backgroundColor: 'red', pronouns: 'x'.repeat(41) }), deps())
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['backgroundColor', 'pronouns', 'timezone'])
    expect(r.values?.company).toBe('Acme')
  })
  it('keeps input on a rate limit', async () => {
    const r = await runProfileSave('did:plc:a', form(typed), deps({ limited: async () => 'Too many saves. Try later.' }))
    expect(r.formError).toBe('Too many saves. Try later.')
    expect(r.values).toMatchObject(typed)
  })
  it('keeps input on a repository write error', async () => {
    const r = await runProfileSave('did:plc:a', form(typed), deps({ save: async () => { throw new Error('Repo down') } }))
    expect(r.formError).toBe('Repo down')
    expect(r.values).toMatchObject(typed)
  })
  it('keeps input when the session expired', async () => {
    const r = await runProfileSave(null, form(typed), deps())
    expect(r.sessionExpired).toBe(true)
    expect(r.values).toMatchObject(typed)
  })
  it('saves valid input and clears color when asked', async () => {
    const d = deps()
    const r = await runProfileSave('did:plc:a', form({ ...typed, backgroundColor: '#112233', clearBackgroundColor: 'on' }), d)
    expect(r.saved).toBe('Profile saved.')
    expect(d.save).toHaveBeenCalledWith('did:plc:a', expect.not.objectContaining({ backgroundColor: expect.anything() }))
  })
})

describe('interests counter', () => {
  it('counts unique interests and flags long ones', () => {
    expect(interestStats('a, b\nA, ,c')).toEqual({ count: 3, tooLong: [], overLimit: false })
    expect(interestStats(`ok, ${'x'.repeat(51)}`).tooLong).toEqual(['x'.repeat(51)])
  })
  it('flags more than the limit', () => {
    const many = Array.from({ length: MAX_INTERESTS + 1 }, (_, i) => `i${i}`).join(',')
    expect(interestStats(many).overLimit).toBe(true)
    expect(validateProfileAll({ ...typed, timezone: '', interests: many }).ok).toBe(false)
  })
  it('box max length fits 20 full-length interests', () => {
    const full = Array.from({ length: MAX_INTERESTS }, (_, i) => String(i).padStart(2, '0').repeat(25)).join(', ')
    expect(full.length).toBeLessThanOrEqual(INTERESTS_BOX_MAX_LENGTH)
  })
})
