// Bundles embed/hovercard.ts into public/embed/hovercard.js (served at /embed/hovercard.js).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({
  entryPoints: [`${root}embed/hovercard.ts`],
  outfile: `${root}public/embed/hovercard.js`,
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
})
