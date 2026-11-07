// Bundles the @blueyvatar/hovercards auto-init into public/embed/hovercard.js (served at /embed/hovercard.js).
// The source lives in packages/hovercards; there is no second copy of the script.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
await build({
  entryPoints: [fileURLToPath(new URL('../../../packages/hovercards/src/auto.ts', import.meta.url))],
  outfile: `${root}public/embed/hovercard.js`,
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
})
