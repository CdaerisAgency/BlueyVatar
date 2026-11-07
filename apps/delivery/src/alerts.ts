import { ENTITLEMENTS, type Tier } from '@blueyvatar/core'
import { periodStart } from './usage.js'
import { errors, log } from './obs.js'

/** Percent of included volume that triggers an alert (spec section 12). */
export const ALERT_THRESHOLDS = [80, 100] as const
export type AlertThreshold = (typeof ALERT_THRESHOLDS)[number]

export interface UsageAlert {
  licenseId: string
  threshold: AlertThreshold
  used: number
  included: number
  period: string
}

export interface AlertSink {
  send(alert: UsageAlert): Promise<void>
}

export class ConsoleAlertSink implements AlertSink {
  async send(a: UsageAlert) {
    log.warn('usage alert', { licenseId: a.licenseId, threshold: a.threshold, used: a.used, included: a.included, period: a.period })
  }
}

/** Remembers which thresholds already fired, so each fires once per period. */
export interface AlertLedger {
  /** True only for the first caller to claim this license, period, and threshold. */
  claim(licenseId: string, period: string, threshold: AlertThreshold): Promise<boolean>
}

export class MemoryAlertLedger implements AlertLedger {
  private seen = new Set<string>()
  async claim(licenseId: string, period: string, threshold: AlertThreshold) {
    const k = `${licenseId}:${period}:${threshold}`
    if (this.seen.has(k)) return false
    this.seen.add(k)
    return true
  }
}

/** Thresholds that `after` has reached or passed and `before` had not. Pure. */
export function crossedThresholds(before: number, after: number, included: number | null): AlertThreshold[] {
  if (!included || included <= 0) return []
  return ALERT_THRESHOLDS.filter((t) => {
    const limit = (included * t) / 100
    return before < limit && after >= limit
  })
}

/** Thresholds a count has reached, for catching up after a counter jumped past several. Pure. */
export function reachedThresholds(used: number, included: number | null): AlertThreshold[] {
  return crossedThresholds(0, used, included)
}

export class UsageAlerts {
  constructor(private sink: AlertSink, private ledger: AlertLedger, private now: () => Date = () => new Date()) {}

  /** Call after an origin resolution raised a license's counter to `used`. Never throws. */
  async check(licenseId: string, tier: Tier, used: number): Promise<void> {
    const included = ENTITLEMENTS[tier].keyedMonthly
    const period = periodStart(this.now())
    try {
      for (const threshold of reachedThresholds(used, included)) {
        if (await this.ledger.claim(licenseId, period, threshold)) {
          await this.sink.send({ licenseId, threshold, used, included: included!, period })
        }
      }
    } catch (err) {
      log.error('usage alert failed', { err })
      errors.captureException(err, { tags: { task: 'usage_alert' } })
    }
  }
}
