import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@blueyvatar/core'],
}
export default config
