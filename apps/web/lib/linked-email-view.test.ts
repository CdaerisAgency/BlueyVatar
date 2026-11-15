import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LinkedEmail from '../app/account/LinkedEmail'
import { COPY } from './copy'
import type { LinkedEmailView } from './linked-emails'

const render = (item: LinkedEmailView) => renderToStaticMarkup(createElement(LinkedEmail, { item }, createElement('button', null, 'Unlink')))

describe('LinkedEmail row', () => {
  it('leads with the full address and a primary badge, with no hash or hashing wording', () => {
    const out = render({ text: 'me@example.com', full: true, method: 'oauth', primary: true })
    expect(out).toContain('me@example.com')
    expect(out).toContain(COPY.linkedEmails.primary)
    expect(out).toContain('Unlink')
    expect(out).not.toMatch(/hash|encrypt|<details/i)
    expect(out).not.toContain('Link again')
  })
  it('shows no primary badge for other addresses', () => {
    expect(render({ text: 'me@example.com', full: true, method: 'code', primary: false })).not.toContain('Primary')
  })
  it('explains an older link and offers Link again to the form, with no hash or details disclosure', () => {
    const out = render({ text: '***@example.com', full: false, method: 'code', primary: false })
    expect(out).toContain('Linked email (address not saved yet)')
    expect(out).toContain('Link the same address again to see it here.')
    expect(out).toMatch(/<a [^>]*href="#link-email"[^>]*>Link again<\/a>/)
    expect(out).not.toMatch(/hash|<details|<summary|Technical/i)
    expect(out).not.toContain('***@')
  })
  it('uses no em-dashes in its copy', () => {
    expect(JSON.stringify(COPY.linkedEmails)).not.toContain(String.fromCharCode(0x2014))
  })
})
