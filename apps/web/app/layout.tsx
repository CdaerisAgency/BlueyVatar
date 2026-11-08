import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Fraunces, Inter } from 'next/font/google'
import { SiteFooter, SiteNav } from '../components/SiteChrome'
import { defaultOgImage, siteUrl } from '../lib/site'
import './globals.css'

const fraunces = Fraunces({ subsets: ['latin'], axes: ['opsz'], weight: 'variable', display: 'swap', variable: '--font-fraunces' })
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-inter' })

const description = 'Avatars and profiles that live in your atproto repository.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'BlueyVatar',
  description,
  // Public pages set their own canonical URL; this covers the rest, resolved against metadataBase.
  alternates: { canonical: './' },
  openGraph: { title: 'BlueyVatar', description, siteName: 'BlueyVatar', type: 'website', images: [defaultOgImage()] },
  twitter: { card: 'summary', title: 'BlueyVatar', description, images: [defaultOgImage()] },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="flex min-h-screen flex-col bg-bv-cream font-sans text-[17px] leading-[1.55] text-bv-black [overflow-wrap:anywhere]">
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  )
}
