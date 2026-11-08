import type { ReactNode } from 'react'
import SideNav from '../../components/SideNav'
import { ACCOUNT_NAV } from '../../lib/account-nav'

/** Every /account page gets the side menu. The menu data goes in as props so the client component stays free of server code. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-auto flex-col px-4 sm:px-5 md:flex-row md:gap-6">
      <SideNav groups={ACCOUNT_NAV} />
      <div className="flex min-w-0 flex-auto flex-col">{children}</div>
    </div>
  )
}
