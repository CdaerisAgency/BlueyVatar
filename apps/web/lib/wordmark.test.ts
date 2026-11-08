import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Wordmark from '../components/Wordmark'
import { WORDMARK_NAME, WORDMARK_VISIBLE } from './wordmark'

describe('Wordmark', () => {
  it('shows BlueyVa’tar and names it BlueyVatar for assistive technology', () => {
    const html = renderToStaticMarkup(createElement(Wordmark))
    expect(html).toContain('aria-label="BlueyVatar"')
    expect(html).toContain('<span aria-hidden="true">BlueyVa’tar</span>')
  })
  it('keeps the apostrophe out of the plain name', () => {
    expect(WORDMARK_NAME).toBe('BlueyVatar')
    expect(WORDMARK_VISIBLE).toBe('BlueyVa’tar')
  })
})
