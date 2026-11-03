import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@blueyvatar/core'],
  // Image uploads are up to 1,000,000 bytes plus form overhead.
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
}
export default config
