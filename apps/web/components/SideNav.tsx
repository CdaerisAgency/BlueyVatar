'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
// Pure helpers only. Nothing here may reach @blueyvatar/core or a node: module.
import { NAV_STORAGE_KEY, currentItemHref, nextIndex, openGroupIds, parseStoredOpen } from '../lib/account-nav'
import type { NavGroup } from '../lib/account-nav'

const target = 'flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-[15px] no-underline'

/** The account menu: a left sidebar from md up, a button and slide-in drawer below. Groups come in as props. */
export default function SideNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname() ?? ''
  const here = currentItemHref(path, groups)
  const [open, setOpen] = useState<string[]>(() => openGroupIds(path, null, groups))
  const [drawer, setDrawer] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Saved state is optional. Read it after mount so the first render matches the server.
  useEffect(() => {
    try {
      setOpen(openGroupIds(path, parseStoredOpen(localStorage.getItem(NAV_STORAGE_KEY)), groups))
    } catch {
      setOpen(openGroupIds(path, null, groups))
    }
  }, [path, groups])

  // Moving to another page closes the drawer.
  useEffect(() => setDrawer(false), [path])

  useEffect(() => {
    if (drawer) closeButton.current?.focus()
  }, [drawer])

  const toggle = (id: string) => {
    const next = open.includes(id) ? open.filter((x) => x !== id) : [...open, id]
    setOpen(next)
    try {
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private window or blocked storage: the menu still works.
    }
  }

  const closeDrawer = useCallback(() => {
    setDrawer(false)
    menuButton.current?.focus()
  }, [])

  const controls = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-nav-control]') ?? []).filter((el) => el.offsetParent !== null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && drawer) {
      e.preventDefault()
      closeDrawer()
      return
    }
    if (e.key === 'Tab' && drawer) {
      // Keep Tab inside the open drawer.
      const all = Array.from(panel.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? []).filter((el) => el.offsetParent !== null)
      const first = all[0]
      const last = all[all.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const list = controls()
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    e.preventDefault()
    list[nextIndex(i, list.length, e.key)]?.focus()
  }

  return (
    <div className="md:w-64 md:flex-none">
      <button
        ref={menuButton}
        type="button"
        aria-expanded={drawer}
        aria-controls="account-menu"
        onClick={() => setDrawer(true)}
        className="mt-4 mb-2 flex min-h-11 items-center gap-2 rounded-bv-pill border-[1.5px] border-bv-black bg-bv-white px-5 py-2 text-[15px] font-semibold text-bv-black md:hidden"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 4.5h14M2 9h14M2 13.5h14" />
        </svg>
        Account menu
      </button>
      {drawer && <div aria-hidden="true" onClick={closeDrawer} className="fixed inset-0 z-30 bg-bv-black/50 md:hidden" />}
      <div
        id="account-menu"
        ref={panel}
        onKeyDown={onKeyDown}
        className={`fixed inset-y-0 left-0 z-40 w-[min(20rem,85vw)] overflow-y-auto border-r-[1.5px] border-bv-line bg-bv-cream p-4 transition-[transform,visibility] duration-200 md:visible md:sticky md:top-4 md:z-auto md:mt-10 md:w-auto md:translate-x-0 md:self-start md:overflow-visible md:border-r-0 md:p-0 ${drawer ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
      >
        <div className="mb-3 flex justify-end md:hidden">
          <button ref={closeButton} type="button" onClick={closeDrawer} className="min-h-11 rounded-bv-pill border-[1.5px] border-bv-black bg-bv-white px-5 py-2 text-[15px] font-semibold text-bv-black">
            Close menu
          </button>
        </div>
        <nav aria-label="Account">
          <ul className="m-0 list-none p-0">
            {groups.map((g) => {
              const isOpen = open.includes(g.id)
              const listId = `account-menu-${g.id}`
              return (
                <li key={g.id} className="mb-1">
                  <button
                    type="button"
                    data-nav-control
                    aria-expanded={isOpen}
                    aria-controls={listId}
                    onClick={() => toggle(g.id)}
                    className={`${target} justify-between gap-2 border-0 bg-transparent font-semibold text-bv-black hover:bg-bv-line`}
                  >
                    {g.label}
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`flex-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                  </button>
                  <ul id={listId} hidden={!isOpen} className="m-0 list-none p-0 pl-3">
                    {g.items.map((item) => {
                      const on = item.href === here
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            data-nav-control
                            aria-current={on ? 'page' : undefined}
                            className={`${target} font-medium ${on ? 'bg-bv-black text-bv-white hover:text-bv-white' : 'text-bv-black hover:bg-bv-line hover:text-bv-black'}`}
                          >
                            {item.label}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </div>
  )
}
