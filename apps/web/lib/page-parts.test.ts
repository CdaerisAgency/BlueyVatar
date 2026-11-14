import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buttonClass } from '../components/Button'
import { Field } from '../components/Field'
import { BackLink, EmptyState, Section } from '../components/Page'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Section', () => {
  it('renders one h2 named by the section, with an optional description', () => {
    const out = html(createElement(Section, { title: 'Your plan', intro: 'What you pay.' }, createElement('p', null, 'Body')))
    expect(out.match(/<h2/g)).toHaveLength(1)
    expect(out).toContain('aria-labelledby="your-plan-title"')
    expect(out).toContain('<h2 id="your-plan-title">Your plan</h2>')
    expect(out).toContain('What you pay.')
  })
  it('keeps a given id and marks the danger tone', () => {
    const out = html(createElement(Section, { title: 'Delete', id: 'danger', tone: 'danger' }))
    expect(out).toContain('id="danger"')
    expect(out).toContain('border-bv-danger')
  })
})

describe('EmptyState and BackLink', () => {
  it('shows one sentence and an optional next action', () => {
    expect(html(createElement(EmptyState, { children: 'Nothing yet.' }))).toContain('Nothing yet.')
    const out = html(createElement(EmptyState, { action: { href: '/account/avatars', label: 'Upload an image' }, children: 'No avatar.' }))
    expect(out).toContain('href="/account/avatars"')
    expect(out).toContain('Upload an image')
  })
  it('names the parent page', () => {
    const out = html(createElement(BackLink, { href: '/account/avatars', children: 'Back to avatars' }))
    expect(out).toContain('href="/account/avatars"')
    expect(out).toContain('Back to avatars')
  })
})

describe('Field', () => {
  it('shows the label, a required marker, the hint, and the error', () => {
    const out = html(createElement(Field, { prefix: 'p', name: 'x', label: 'Name', hint: 'Shown on your profile.', error: 'Too long.', required: true, children: createElement('input', { id: 'p-x' }) }))
    expect(out).toContain('Name')
    expect(out).toContain('aria-hidden="true"> *')
    expect(out).toContain('id="p-x-hint"')
    expect(out).toContain('id="p-x-error"')
  })
  it('leaves out the marker, hint, and error when not given', () => {
    const out = html(createElement(Field, { prefix: 'p', name: 'x', label: 'Name', children: createElement('input') }))
    expect(out).not.toContain('*')
    expect(out).not.toContain('-hint')
    expect(out).not.toContain('-error')
  })
})

describe('button variants', () => {
  it('has primary, secondary, and danger', () => {
    expect(buttonClass('primary')).toContain('bg-bv-orange')
    expect(buttonClass('secondary')).toContain('bg-transparent')
    expect(buttonClass('danger')).toContain('bg-bv-danger')
  })
})
