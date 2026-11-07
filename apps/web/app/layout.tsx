import type { ReactNode } from 'react'
import { Fraunces, Inter } from 'next/font/google'
import { SiteFooter, SiteNav } from '../components/SiteChrome'
import './globals.css'

const fraunces = Fraunces({ subsets: ['latin'], axes: ['opsz'], weight: 'variable', display: 'swap', variable: '--font-fraunces' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-inter' })

export const metadata = {
  title: 'blueyvatar',
  description: 'Avatars and profiles that live in your atproto repository.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
