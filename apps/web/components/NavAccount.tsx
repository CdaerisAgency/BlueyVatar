'use client'

import { COPY } from '../lib/copy'
import { ButtonLink } from './Button'
import ProfileMenu from './ProfileMenu'
import { useViewer } from './useViewer'

/** Sign-in button for visitors, profile menu once /api/viewer says someone is signed in. */
export default function NavAccount() {
  const v = useViewer()
  return v.signedIn ? (
    <ProfileMenu name={v.name} initial={v.initial} />
  ) : (
    <ButtonLink href="/login" variant="primary">
      {COPY.nav.signIn}
    </ButtonLink>
  )
}
