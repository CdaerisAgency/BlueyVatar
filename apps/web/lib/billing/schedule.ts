import type { PaidPlan } from '@blueyvatar/core'
import { tierForPrice, type Env } from './config'

/**
 * Helpers for a Stripe subscription schedule that moves a subscription to a cheaper price at the end of the current
 * period (https://docs.stripe.com/billing/subscriptions/subscription-schedules and its use-cases page). Server only.
 * The shapes are the few fields we read, so a mock in tests stays small.
 */
type PriceRef = string | { id?: string } | null | undefined
export const priceIdOf = (p: PriceRef): string | null => (typeof p === 'string' ? p : (p?.id ?? null))

export interface SchedulePhase {
  start_date?: number
  end_date?: number
  items?: Array<{ price?: PriceRef; quantity?: number | null }>
  metadata?: Record<string, string> | null
  automatic_tax?: { enabled?: boolean } | null
  discounts?: unknown[] | null
  add_invoice_items?: unknown[] | null
  trial_end?: number | null
}

export interface ScheduleLike {
  id: string
  status?: string
  subscription?: PriceRef
  current_phase?: { start_date?: number; end_date?: number } | null
  phases?: SchedulePhase[]
}

/** A downgrade that is waiting for the period to end. */
export interface PendingChange {
  tier: PaidPlan
  /** When the new plan starts: the start of the next phase, which is the end of the current period. */
  at: Date
  scheduleId: string
}

/** The future phase of an attached schedule that moves the subscription to a plan we sell, or null. */
export function pendingChangeOf(schedule: ScheduleLike | null | undefined, env: Env, now: Date): PendingChange | null {
  if (!schedule || (schedule.status && !['active', 'not_started'].includes(schedule.status))) return null
  const nowSec = Math.floor(now.getTime() / 1000)
  const next = (schedule.phases ?? []).find((p) => typeof p.start_date === 'number' && p.start_date > nowSec)
  const price = priceIdOf(next?.items?.[0]?.price)
  const tier = price ? tierForPrice(price, env) : null
  return next && tier ? { tier, at: new Date(next.start_date! * 1000), scheduleId: schedule.id } : null
}
