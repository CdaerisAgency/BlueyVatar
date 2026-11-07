import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@blueyvatar/core'],
  // Image uploads are up to 5 MiB (MAX_BLOB_BYTES in lib/records.ts) plus form overhead.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  async headers() {
    return [{ source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] }]
  },
}
export default config
