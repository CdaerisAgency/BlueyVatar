import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { avatarUrl, emailHash } from '@blueyvatar/avatar'

const plugin = (f: string) => new URL(`../../../integrations/wordpress/${f}`, import.meta.url).pathname
const hasPhp = spawnSync('php', ['-v']).status === 0

// The PHP builder and @blueyvatar/avatar must produce the same hash and URL. CI runs this where PHP is installed.
describe.skipIf(!hasPhp)('WordPress plugin matches @blueyvatar/avatar', () => {
  const out = JSON.parse(execFileSync('php', [plugin('tests/test-url.php'), '--json'], { encoding: 'utf8' })) as { hash: string; url: string }

  it('computes the same SHA-256 email hash', async () => {
    expect(out.hash).toBe(await emailHash(' Ada@Example.com '))
  })

  it('builds the same URL', async () => {
    const hash = await emailHash('ada@example.com')
    expect(out.url).toBe(avatarUrl({ hash, size: 96, default: 'identicon', rating: 'pg' }))
  })

  it('passes the PHP unit test', () => {
    expect(execFileSync('php', [plugin('tests/test-url.php')], { encoding: 'utf8' }).trim()).toBe('ok')
  })
})
