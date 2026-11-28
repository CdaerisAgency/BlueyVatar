import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({ Fraunces: () => ({ variable: '' }), Inter: () => ({ variable: '' }) }))
vi.mock('../components/BugReport', () => ({ default: () => null }))
vi.mock('../components/SiteChrome', () => ({ SiteFooter: () => null, SiteNav: () => null }))
vi.mock('../app/globals.css', () => ({}))

describe('root layout metadata', () => {
  it('adds the brand suffix to child page titles', async () => {
    const { metadata } = await import('../app/layout')
    expect(metadata.title).toEqual({ default: 'BlueyVatar', template: '%s | BlueyVatar' })
  })
})
