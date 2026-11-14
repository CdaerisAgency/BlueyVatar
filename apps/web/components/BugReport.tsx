'use client'

import { useEffect, useId, useRef, useState } from 'react'
import {
  MAX_CONTACT, MAX_DESCRIPTION, MIN_DESCRIPTION, SCREENSHOT_TYPES, pagePath, sentSummary,
} from '../lib/bug-report'
import { buttonClass } from './Button'
import { canCaptureScreen, captureTab, fileToScreenshot } from './bug-report-capture'

type Availability = { available: boolean; signedIn: boolean }
type Sent = { url: string; number: number }
type Ctx = { page: string; userAgent: string; width: number; height: number }

const field = 'block w-full rounded-lg border-[1.5px] border-bv-black bg-bv-white px-3 py-2 text-[16px] text-bv-black'

function BugIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z" />
      <path d="M12 8v12M8 12H4M20 12h-4M8 17l-3 2M16 17l3 2M8 8 5 6M16 8l3-2M9.5 4.5 8.5 3M14.5 4.5l1-1.5" />
    </svg>
  )
}

/**
 * The bug report button and its dialog (issue 266). Hidden until /api/bug-report says reports are available, so a
 * deployment without the GitHub token shows nothing. The dialog is a native modal <dialog>: the browser traps focus
 * inside it and closes it on Escape, and the button gets focus back when it closes. Nothing here holds a token; the
 * server files the issue.
 */
export default function BugReport() {
  const [state, setState] = useState<Availability | null>(null)
  const [description, setDescription] = useState('')
  const [contact, setContact] = useState('')
  const [includeHandle, setIncludeHandle] = useState(false)
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null)
  const [busy, setBusy] = useState<'capture' | 'send' | null>(null)
  const [error, setError] = useState<{ field?: string; message: string } | null>(null)
  const [sent, setSent] = useState<Sent | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [canCapture, setCanCapture] = useState(false)

  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const contactRef = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const website = useRef<HTMLInputElement>(null)
  const ids = useId()

  useEffect(() => {
    let live = true
    fetch('/api/bug-report', { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Availability>) : { available: false, signedIn: false }))
      .catch(() => ({ available: false, signedIn: false }))
      .then((a) => live && setState(a))
    setCanCapture(canCaptureScreen())
    return () => {
      live = false
    }
  }, [])

  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot])

  if (!state?.available) return null

  const snapshot = (): Ctx => ({ page: pagePath(window.location.pathname), userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight })

  function openDialog() {
    // Taken when the dialog opens, so the report describes the page the problem was on.
    setCtx((c) => c ?? snapshot())
    setError(null)
    dialog.current?.showModal()
  }

  /** A native modal dialog keeps focus on the page behind it out, but Tab can still leave for the browser's own controls. This wraps Tab and Shift+Tab inside the dialog. */
  function trapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]):not([type="hidden"]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length > 0)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /** Closing keeps the draft. Send and Discard are the only things that clear it. */
  function closeDialog() {
    dialog.current?.close()
  }

  function resetAll() {
    setDescription('')
    setContact('')
    setIncludeHandle(false)
    setShot(null)
    setSent(null)
    setError(null)
    setCtx(null)
  }

  function discard() {
    resetAll()
    closeDialog()
  }

  function keepShot(blob: Blob) {
    setShot({ blob, url: URL.createObjectURL(blob) })
    setError(null)
  }

  async function attach(file: File | undefined) {
    if (!file) return
    setBusy('capture')
    try {
      keepShot(await fileToScreenshot(file))
    } catch (err) {
      setError({ field: 'screenshot', message: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  async function capture() {
    setBusy('capture')
    // The dialog steps aside so it is not in the picture. The draft stays in state.
    closeDialog()
    try {
      const blob = await captureTab()
      if (blob) keepShot(blob)
    } catch (err) {
      setError({ field: 'screenshot', message: (err as Error).message })
    } finally {
      setBusy(null)
      dialog.current?.showModal()
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const c = ctx ?? snapshot()
    setBusy('send')
    setError(null)
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          description, contact, includeHandle, page: c.page, userAgent: c.userAgent, viewportWidth: c.width, viewportHeight: c.height,
          hasScreenshot: shot !== null, website: website.current?.value ?? '',
        }),
      })
      const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; field?: string; number?: number; url?: string } | null
      if (res.ok && out?.ok) {
        setSent({ url: out.url ?? '', number: out.number ?? 0 })
        setDescription('')
        setContact('')
        setIncludeHandle(false)
        return
      }
      const message = out?.error ?? 'The report could not be sent. Try again later.'
      setError({ field: out?.field, message })
      if (out?.field === 'description') descRef.current?.focus()
      else if (out?.field === 'contact') contactRef.current?.focus()
    } catch {
      setError({ message: 'The report could not be sent. Check your connection and try again.' })
    } finally {
      setBusy(null)
    }
  }

  const hasDraft = !sent && (description !== '' || contact !== '' || shot !== null)
  const summary = sentSummary({ page: ctx?.page ?? '', viewport: ctx ? `${ctx.width}x${ctx.height}` : '', hasContact: contact.trim() !== '', includeHandle })
  const errFor = (f: string) => (error?.field === f ? error.message : null)

  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={openDialog}
        className={buttonClass('primary', 'md', 'fixed right-4 bottom-4 z-40 inline-flex items-center gap-2 shadow-md motion-reduce:transition-none')}
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        title={hasDraft ? 'Reopen your unsent bug report' : 'Report a bug'}
      >
        <BugIcon />
        <span className="sr-only sm:not-sr-only">{hasDraft ? 'Unsent report' : 'Report a bug'}</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={`${ids}-title`}
        onKeyDown={trapTab}
        onClose={() => {
          // Whatever closed it (Escape, Close, Done), the button gets focus back. A sent report is finished, so it is cleared.
          if (sent) resetAll()
          opener.current?.focus()
        }}
        className="m-auto max-h-[calc(100dvh-1.5rem)] w-[min(34rem,calc(100vw-1.5rem))] overflow-y-auto rounded-bv-card border-[1.5px] border-bv-black bg-bv-cream p-5 text-bv-black backdrop:bg-black/50 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${ids}-title`} className="m-0 font-display text-2xl font-semibold">Report a bug</h2>
          <button type="button" onClick={closeDialog} className={buttonClass('secondary', 'md', 'px-4 py-2')}>Close</button>
        </div>

        {sent ? (
          <div className="mt-4" role="status">
            <p className="m-0 font-semibold">Thank you. Your report was sent.</p>
            {sent.url && (
              <p className="mt-2">
                It is issue <a href={sent.url} className="text-bv-orange-deep underline" target="_blank" rel="noopener noreferrer">#{sent.number} on GitHub</a>, which may be public.
              </p>
            )}
            {shot && (
              <p className="mt-2">
                Your screenshot was not sent. <a href={shot.url} download="screenshot.jpg" className="text-bv-orange-deep underline">Save it</a> and add it to the issue if you want us to see it.
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={discard} className={buttonClass('primary')}>Done</button>
            </div>
          </div>
        ) : !state.signedIn ? (
          <div className="mt-4">
            <p className="m-0">Sign in to send a bug report. Reports are tied to your account so we can limit spam.</p>
            <p className="mt-4"><a href="/login" className={buttonClass('primary')}>Sign in</a></p>
          </div>
        ) : (
          <form onSubmit={send} className="mt-4 grid gap-4" noValidate>
            <p className="m-0 text-[15px] text-bv-ink-2">This files an issue in our GitHub repository. Issues can be public, so leave out passwords and private details.</p>

            <div>
              <label htmlFor={`${ids}-desc`} className="mb-1 block font-semibold">What went wrong? <span className="font-normal text-bv-ink-3">(required)</span></label>
              <textarea
                id={`${ids}-desc`}
                ref={descRef}
                className={field}
                rows={5}
                maxLength={MAX_DESCRIPTION}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-invalid={errFor('description') ? true : undefined}
                aria-describedby={`${ids}-desc-help${errFor('description') ? ` ${ids}-desc-err` : ''}`}
              />
              <p id={`${ids}-desc-help`} className="mt-1 mb-0 text-[14px] text-bv-ink-3">
                At least {MIN_DESCRIPTION} characters. {description.length} of {MAX_DESCRIPTION}.
              </p>
              {errFor('description') && <p id={`${ids}-desc-err`} role="alert" className="mt-1 mb-0 text-[14px] font-semibold text-bv-orange-deep">{errFor('description')}</p>}
            </div>

            <div>
              <label htmlFor={`${ids}-contact`} className="mb-1 block font-semibold">Contact email <span className="font-normal text-bv-ink-3">(optional)</span></label>
              <input
                id={`${ids}-contact`}
                ref={contactRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                className={field}
                maxLength={MAX_CONTACT}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                aria-invalid={errFor('contact') ? true : undefined}
                aria-describedby={`${ids}-contact-help${errFor('contact') ? ` ${ids}-contact-err` : ''}`}
              />
              <p id={`${ids}-contact-help`} className="mt-1 mb-0 text-[14px] text-bv-ink-3">If you add one, it is written in the issue, where others may see it.</p>
              {errFor('contact') && <p id={`${ids}-contact-err`} role="alert" className="mt-1 mb-0 text-[14px] font-semibold text-bv-orange-deep">{errFor('contact')}</p>}
            </div>

            <div className="flex items-start gap-3">
              <input id={`${ids}-handle`} type="checkbox" className="mt-1 size-5" checked={includeHandle} onChange={(e) => setIncludeHandle(e.target.checked)} />
              <label htmlFor={`${ids}-handle`}>Include my handle in the issue. Without it the issue says only that a signed-in account sent it.</label>
            </div>

            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 p-0 font-semibold">Screenshot <span className="font-normal text-bv-ink-3">(optional)</span></legend>
              <p className="m-0 text-[14px] text-bv-ink-3">A screenshot can show personal information such as your name, email, or other tabs. Check the preview. We strip photo metadata, shrink it, and keep it in your browser: it is not uploaded with the report.</p>
              {shot && (
                <div className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL has nothing for the image optimizer to fetch */}
                  <img src={shot.url} alt="Preview of your screenshot" className="max-h-40 max-w-[60%] rounded-lg border-[1.5px] border-bv-line" />
                  <button type="button" onClick={() => setShot(null)} className={buttonClass('secondary', 'md', 'px-4 py-2')}>Remove screenshot</button>
                </div>
              )}
              {!shot && (
                <div className="flex flex-wrap gap-3">
                  {canCapture && (
                    <button type="button" disabled={busy !== null} onClick={() => void capture()} className={buttonClass('secondary', 'md', 'px-4 py-2')}>
                      Capture this page
                    </button>
                  )}
                  <button type="button" disabled={busy !== null} onClick={() => filePicker.current?.click()} className={buttonClass('secondary', 'md', 'px-4 py-2')}>
                    Attach a picture
                  </button>
                  <input
                    ref={filePicker}
                    type="file"
                    accept={SCREENSHOT_TYPES.join(',')}
                    hidden
                    tabIndex={-1}
                    aria-label="Choose a screenshot file"
                    onChange={(e) => {
                      void attach(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </div>
              )}
              {errFor('screenshot') && <p role="alert" className="m-0 text-[14px] font-semibold text-bv-orange-deep">{errFor('screenshot')}</p>}
            </fieldset>

            {/* Hidden from people and from assistive technology. A bot that fills every field fills this one too. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Leave this empty<input ref={website} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
            </div>

            <details className="text-[15px]">
              <summary className="cursor-pointer font-semibold">What is sent with this report</summary>
              <ul className="mt-2 mb-0 pl-5">
                {summary.map((s) => <li key={s}>{s}</li>)}
              </ul>
            </details>

            {error && !error.field && <p role="alert" className="m-0 font-semibold text-bv-orange-deep">{error.message}</p>}

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy !== null} className={buttonClass('primary')}>{busy === 'send' ? 'Sending...' : 'Send report'}</button>
              <button type="button" onClick={discard} className={buttonClass('secondary')}>Discard</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  )
}
