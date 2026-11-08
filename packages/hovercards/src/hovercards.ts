/**
 * blueyvatar hovercards. Hovercards need a publishable key from a Plus, Business, or Enterprise license.
 *   import { init } from '@blueyvatar/hovercards'
 *   init({ key: 'pk_...' })
 *   <img src="..." data-blueyvatar="alice.example.com">
 * No cookies are sent or set, images use referrerPolicy no-referrer, and all text is set with textContent.
 */
import { buildCard, cleanId, profileEndpoint, type Card } from './model.js'

export interface HovercardOptions {
  /** Publishable key (pk_...) from a Plus, Business, or Enterprise license. */
  key: string
  /** Delivery origin. Defaults to `web`. */
  api?: string | undefined
  /** Origin of the profile pages the card links to. Defaults to https://blueyvatar.com. */
  web?: string | undefined
}

/** Starts listening for [data-blueyvatar] elements. Returns a function that removes everything it added. */
export function init(opts: HovercardOptions): () => void {
  const token = opts.key
  const web = (opts.web || 'https://blueyvatar.com').replace(/\/$/, '')
  const api = (opts.api || web).replace(/\/$/, '')
  const ac = new AbortController()
  const on = { signal: ac.signal }
  const cache = new Map<string, Promise<Card | null>>()
  let card: HTMLElement | null = null
  let owner: Element | null = null
  let timer = 0
  let seq = 0

  const load = (id: string) => {
    let p = cache.get(id)
    if (!p) {
      p = fetch(profileEndpoint(api, id, token), { credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j ? buildCard(j, api, web) : null))
        .catch(() => null)
      cache.set(id, p)
    }
    return p
  }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string) => {
    const e = document.createElement(tag)
    e.style.cssText = css
    if (text) e.textContent = text
    return e
  }

  const hide = () => {
    clearTimeout(timer)
    seq++
    card?.remove()
    card = owner = null
  }

  const render = (c: Card, target: Element) => {
    hide()
    owner = target
    card = el('div', 'position:fixed;z-index:2147483647;max-width:280px;box-sizing:border-box;padding:12px;display:flex;gap:10px;align-items:flex-start;background:#ffffff;color:#1a1a1a;border:1.5px solid #e6dfd3;border-radius:16px;box-shadow:0 4px 16px rgba(26,26,26,.18);font:14px/1.4 system-ui,sans-serif')
    if (c.colors) {
      // Hex values only (checked in model.ts). The link and the account line take the text color so contrast holds.
      card.style.background = c.colors.background
      card.style.color = c.colors.text
    }
    card.id = 'bv-card-' + ++seq
    card.setAttribute('role', 'group')
    card.setAttribute('aria-label', c.name)
    if (c.avatarUrl) {
      const i = el('img', 'width:48px;height:48px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 2px #ffffff,0 0 0 4px #1a1a1a;margin:4px')
      i.alt = ''
      i.referrerPolicy = 'no-referrer'
      i.src = c.avatarUrl
      card.append(i)
    }
    const body = el('div', 'min-width:0;overflow-wrap:anywhere')
    body.append(el('strong', 'display:block', c.name))
    for (const l of c.lines) body.append(el('div', '', l))
    if (c.accounts.length) body.append(el('div', 'font-size:12px;' + (c.colors ? '' : 'color:#6b6660'), c.accounts.join(', ')))
    if (c.profileUrl) {
      const a = el('a', 'display:inline-block;margin-top:4px;font-weight:600;color:' + (c.colors ? 'inherit' : '#b4400e'), 'View profile')
      a.href = c.profileUrl
      a.rel = 'noopener'
      body.append(a)
    }
    card.append(body)
    card.addEventListener('mouseenter', () => clearTimeout(timer))
    card.addEventListener('mouseleave', () => schedule(0, 250))
    card.addEventListener('focusout', (e) => {
      if (!card?.contains((e as FocusEvent).relatedTarget as Node) && (e as FocusEvent).relatedTarget !== owner) hide()
    })
    document.body.append(card)
    const r = target.getBoundingClientRect()
    const w = card.offsetWidth
    card.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px'
    card.style.top = (r.bottom + 8 + card.offsetHeight > innerHeight && r.top > card.offsetHeight + 16 ? r.top - card.offsetHeight - 8 : r.bottom + 8) + 'px'
    target.setAttribute('aria-describedby', card.id)
  }

  const schedule = (show: 0 | 1, ms: number, target?: Element) => {
    clearTimeout(timer)
    timer = window.setTimeout(async () => {
      if (!show || !target) return hide()
      const id = cleanId(target.getAttribute('data-blueyvatar'))
      if (!id || !token) return
      const mine = ++seq
      const c = await load(id)
      if (c && mine === seq) render(c, target)
    }, ms)
  }

  const trigger = (e: Event) => (e.target as Element | null)?.closest?.('[data-blueyvatar]') ?? null

  document.addEventListener('mouseover', (e) => {
    const t = trigger(e)
    if (t) schedule(1, 200, t)
  }, on)
  document.addEventListener('mouseout', (e) => {
    if (trigger(e)) schedule(0, 250)
  }, on)
  document.addEventListener('focusin', (e) => {
    const t = trigger(e)
    if (t) schedule(1, 0, t)
  }, on)
  document.addEventListener('focusout', (e) => {
    const t = trigger(e)
    if (t && !card?.contains((e as FocusEvent).relatedTarget as Node)) schedule(0, 100)
  }, on)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card) {
      const o = owner as HTMLElement | null
      hide()
      o?.focus?.()
    } else if (e.key === 'Enter' && card && trigger(e) === owner) {
      card.querySelector('a')?.focus()
    }
  }, on)

  // Make plain avatar images reachable by keyboard.
  const arm = (root: ParentNode) => {
    for (const t of root.querySelectorAll<HTMLElement>('[data-blueyvatar]')) {
      if (!t.matches('a,button,input,[tabindex]')) t.tabIndex = 0
    }
  }
  let observer: MutationObserver | undefined
  const start = () => {
    arm(document)
    observer = new MutationObserver(() => arm(document))
    observer.observe(document.body, { childList: true, subtree: true })
  }
  if (!token) console.warn('blueyvatar hovercards: a key is required (Plus, Business, or Enterprise publishable key).')
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true, ...on })
  else start()
  return () => {
    ac.abort()
    observer?.disconnect()
    hide()
  }
}
