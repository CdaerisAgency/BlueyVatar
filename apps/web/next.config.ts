import type { NextConfig } from 'next'
import { SESSION_ROUTES } from './lib/chrome'

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@blueyvatar/core'],
  // Image uploads are up to 5 MiB (MAX_BLOB_BYTES in lib/records.ts) plus form overhead.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    return [
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      // Pages that read the session cookie on the server. Cloudflare and browsers never share them between visitors.
      ...SESSION_ROUTES.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: 'private, no-store' }] })),
    ]
  },
}
export default config
