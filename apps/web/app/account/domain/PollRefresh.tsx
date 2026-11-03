'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-renders the server page every 15 seconds while a domain is pending, which re-polls Cloudflare. */
export function PollRefresh({ active }: { active: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(t)
  }, [active, router])
  return null
}
