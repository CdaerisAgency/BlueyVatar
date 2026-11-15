import { tickAway } from '../../../../lib/effects/flow'
import { liveDeps } from '../../../../lib/effects/live'
import { makeTickRoute } from '../../../../lib/tick-route'

export const dynamic = 'force-dynamic'

/**
 * Called by the indexer job when an out-of-office window starts or ends. The web app does the work because only it
 * holds the OAuth keys that write to a user's repository. Off (404) until EFFECTS_TICK_SECRET is set. One account
 * per call; the step re-checks that it is due, so a repeat does nothing.
 */
export const POST = makeTickRoute('effects', async (did) => tickAway(await liveDeps(did), did))
