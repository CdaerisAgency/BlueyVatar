import type { ReactNode } from 'react'

export const metadata = { title: 'Admin', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children
}
