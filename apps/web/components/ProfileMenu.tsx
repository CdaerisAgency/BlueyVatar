'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

/** The signed-in header control: avatar (or letter) that opens a menu with the handle, Settings, and Log out. */
export default function ProfileMenu({ name, initial, avatarSrc }: { name: string; initial: string; avatarSrc?: string | null }) {
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState<string | null>(null)
  // Horizontal offset of the panel from the button, in px. The panel lines up with the button's right edge, then is
  // moved so it stays 16 px inside the screen: when the header wraps on a phone the button can sit anywhere in the row.
  const [offset, setOffset] = useState(0)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && !panel.current?.contains(next) && !btn.current?.contains(next)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    const p = panel.current
    p?.addEventListener('focusout', onFocusOut)
    p?.querySelector<HTMLElement>('a,button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      p?.removeEventListener('focusout', onFocusOut)
    }
  }, [open])

  const item = 'block w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-[15px] font-medium text-bv-black no-underline hover:bg-bv-line hover:text-bv-black'
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account menu for ${name}`}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect()
          if (r) {
            // The panel is 16rem wide, capped at the viewport minus 2rem (see its classes).
            const width = Math.min(256, window.innerWidth - 32)
            const left = Math.min(Math.max(r.right - width, 16), window.innerWidth - 16 - width)
            setOffset(left - r.left)
          }
          setOpen((o) => !o)
        }}
        className="flex size-11 cursor-pointer items-center justify-center overflow-hidden rounded-full border-[1.5px] border-bv-black bg-bv-orange p-0 font-semibold text-bv-black"
      >
        {avatarSrc && broken !== avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarSrc} alt="" className="size-full object-cover" onError={() => setBroken(avatarSrc)} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          style={{ left: offset }}
          className="absolute z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-bv-card border-[1.5px] border-bv-black bg-bv-white p-2 shadow-lg"
        >
          <p className="m-0 px-3 py-2 text-sm break-all text-bv-ink-3">
            <span className="block text-xs tracking-[0.08em] uppercase">Signed in as</span>
            <strong className="text-bv-black">{name}</strong>
          </p>
          <hr className="my-1 border-bv-line" />
          <Link href="/account" className={item} onClick={() => setOpen(false)}>
            Your account
          </Link>
          <Link href="/account/settings" className={item} onClick={() => setOpen(false)}>
            Settings
          </Link>
          <form action="/logout" method="post" className="m-0">
            <button type="submit" className={item}>
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
