import { applyFrame } from '../effects/flow'
import { liveDeps as effectsDeps } from '../effects/live'
import { getEffectsStore } from '../effects/store'
import type { ScheduleDeps } from './flow'
import { liveHolidayData } from '../holidays/data'
import { getScheduleStore } from './store'

/** Real dependencies for one account. Throws RepoError when the stored sign-in is gone. */
export async function liveScheduleDeps(did: string): Promise<ScheduleDeps> {
  const fx = await effectsDeps(did)
  return {
    store: getScheduleStore(),
    effects: () => getEffectsStore().get(did),
    repo: fx.repo,
    plan: fx.plan,
    // The saved look stays applied: render it again from the scheduled image through the effects flow.
    applyLook: (sourceRkey, e) => applyFrame(fx, did, { sourceRkey, style: e.frameStyle ?? '', color: e.frameColor ?? '', filter: e.filterId ?? '' }),
    push: fx.push,
    now: fx.now,
    holidays: liveHolidayData,
  }
}
