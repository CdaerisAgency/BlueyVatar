import { createServer, type Server } from 'node:http'

const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 3101)

/** The seeded profile the delivery stub serves. */
export const SEEDED = {
  handle: 'alice.test',
  did: 'did:plc:e2ealice0000000000000000',
  displayName: 'Alice Example',
  description: 'Seeded for the browser tests.',
}

/** Stands in for the delivery API: /profile/{handle} for the seeded account, 404 for anything else. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const server: Server = createServer((req, res) => {
    const m = /^\/profile\/([^/?]+)/.exec(req.url ?? '')
    if (m && decodeURIComponent(m[1]!).toLowerCase() === SEEDED.handle) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        did: SEEDED.did, handle: SEEDED.handle, displayName: SEEDED.displayName, description: SEEDED.description,
        avatar: null, jobTitle: 'Engineer', company: 'Example Co', location: 'Lisbon', pronouns: 'she/her',
        links: [], interests: ['birds'], verifiedAccounts: [],
      }))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":{"code":"not_found"}}')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(STUB_PORT, '127.0.0.1', resolve)
  })
  return () => new Promise<void>((resolve) => void server.close(() => resolve()))
}
