import type { ReactNode } from 'react'

export const metadata = {
  title: 'blueyvatar',
  description: 'Avatars and profiles that live in your atproto repository.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 16 }}>{children}</body>
    </html>
  )
}
