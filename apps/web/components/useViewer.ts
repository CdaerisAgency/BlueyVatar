'use client'

import { useEffect, useState } from 'react'

export type ClientViewer = { signedIn: false } | { signedIn: true; name: string; initial: string }

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
    inflight = null
    void load().then((r) => live && setV(r))
    return () => {
      live = false
    }
  }, [])
  return v
}
