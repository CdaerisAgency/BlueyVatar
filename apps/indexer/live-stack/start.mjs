// Local PLC directory and PDS for the live Tap test (issue #42). Nothing here talks to the
// network: the PLC directory uses an in-memory database and the PDS uses temp directories.
//
// Prints one JSON line to stdout when ready ({"ready":true,...}), then runs until SIGTERM, SIGINT,
// or until stdin closes (so it dies with the test process).
//
// Env: LIVE_STACK_PDS_PORT and LIVE_STACK_PLC_PORT (default: free ports). dev-env binds all
// interfaces, which is what a Tap container on host networking needs.
import { randomBytes } from 'node:crypto'
import { TestNetworkNoAppView } from '@atproto/dev-env'

const pdsPort = process.env.LIVE_STACK_PDS_PORT ? Number(process.env.LIVE_STACK_PDS_PORT) : undefined
const plcPort = process.env.LIVE_STACK_PLC_PORT ? Number(process.env.LIVE_STACK_PLC_PORT) : undefined

const network = await TestNetworkNoAppView.create({
  plc: plcPort ? { port: plcPort } : {},
  pds: pdsPort ? { port: pdsPort } : {},
})

const password = randomBytes(12).toString('hex')
const handle = 'tap-live.test'
const account = await network.pds.getAgent().createAccount({ email: 'tap-live@example.test', handle, password })

console.log(
  JSON.stringify({
    ready: true,
    plcUrl: network.plc.url,
    pdsUrl: network.pds.url,
    did: account.data.did,
    handle,
    password,
  }),
)

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  try {
    await network.close()
  } finally {
    process.exit(0)
  }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.stdin.on('end', shutdown)
process.stdin.resume()
