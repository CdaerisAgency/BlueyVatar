// Shared helpers for the accessibility scripts: a stub delivery service, `next start`, and a signed session cookie.
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

export const webRoot = fileURLToPath(new URL('..', import.meta.url))
export const SECRET = 'a11y-session-secret'
export const DID = 'did:plc:a11yseeded000000000000'

/** Same format as lib/session-cookie.ts: did.expiresAtMs.hmac (base64url). */
export function sessionCookie(now = Date.now()) {
  const body = `${DID}.${now + 3_600_000}`
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`
}

const PROFILE = {
  did: 'did:plc:a11yprofile00000000000000',
  handle: 'alice.example.com',
  displayName: 'Alice Example',
  pronouns: 'she/her',
  jobTitle: 'Engineer',
  company: 'Acme',
  location: 'Paris',
  interests: ['maps', 'tea'],
  avatar: { url: '/img/avatar.svg' },
}

const AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#f28c28"/></svg>'

/** A minimal delivery service so the profile page renders without Postgres or a PDS. */
export function startDelivery(port) {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/profile/')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(PROFILE))
    } else if (req.url?.startsWith('/img/')) {
      res.setHeader('content-type', 'image/svg+xml')
      res.end(AVATAR)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

/** Starts `next start` (the app must already be built) and waits until it answers. */
export async function startWeb(port, deliveryPort) {
  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    cwd: webRoot,
    env: {
      ...process.env,
      SESSION_SECRET: SECRET,
      PUBLIC_URL: `http://localhost:${port}`,
      DELIVERY_URL: `http://127.0.0.1:${deliveryPort}`,
      DATABASE_URL: '',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
  })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/pricing`)).ok) return child
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  process.kill(-child.pid)
  throw new Error('next start did not become ready')
}
