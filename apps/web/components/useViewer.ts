'use client'

import { useEffect, useState } from 'react'

export type ClientViewer = { signedIn: false } | { signedIn: true; name: string; initial: string; avatarSrc?: string | null }

let inflight: Promise<ClientViewer> | null = null

/** One /api/viewer request per page load, shared by the header, footer, and pricing buttons. Starts signed out. */
function load(): Promise<ClientViewer> {
  inflight ??= fetch('/api/viewer', { cache: 'no-store', credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<ClientViewer>) : { signedIn: false as const }))
    .catch(() => ({ signedIn: false as const }))
  return inflight
}

export function useViewer(): ClientViewer {
  const [v, setV] = useState<ClientViewer>({ signedIn: false })
  useEffect(() => {
    let live = true
    const refresh = () => {
      inflight = null
      void load().then((r) => live && setV(r))
    }
    refresh()
    // A page restored from the Back/forward cache does not run this effect again, so ask again, or the header keeps
    // showing the state from before the person left (for example, signed in after signing out).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh()
    }
    window.addEventListener('pageshow', onShow)
    return () => {
      live = false
      window.removeEventListener('pageshow', onShow)
    }
  }, [])
  return v
}
