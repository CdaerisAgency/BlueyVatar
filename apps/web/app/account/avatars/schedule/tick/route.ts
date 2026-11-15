import { tickSchedule } from '../../../../../lib/schedule/flow'
import { liveScheduleDeps } from '../../../../../lib/schedule/live'
import { makeTickRoute } from '../../../../../lib/tick-route'

export const dynamic = 'force-dynamic'

/**
 * Called by the indexer job when an avatar calendar has a change due (issue #219). Same secret as the out-of-office
 * tick. The web app does the work because only it holds the OAuth keys that write to a user's repository. Off (404)
 * until EFFECTS_TICK_SECRET is set. One account per call; the step re-checks that it is due, so a repeat does nothing.
 */
export const POST = makeTickRoute('schedule', async (did) => tickSchedule(await liveScheduleDeps(did), did))
