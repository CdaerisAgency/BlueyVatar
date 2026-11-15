'use client'

import { ButtonLink } from './Button'
import { heroTarget } from '../lib/chrome'
import { useViewer } from './useViewer'

/** Landing page call to action. Reads the session in the browser so the page itself stays static and shared-cacheable. */
export default function HeroCta({ children }: { children: string }) {
  const v = useViewer()
  return (
    <ButtonLink href={heroTarget(v.signedIn)} variant="primary" size="lg">
      {children}
    </ButtonLink>
  )
}
