'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Old links point at /#pricing. A fragment never reaches the server, so the redirect to /pricing happens in the browser. */
export function PricingHashRedirect() {
  const router = useRouter()
  useEffect(() => {
    if (window.location.hash === '#pricing') router.replace('/pricing')
  }, [router])
  return null
}
