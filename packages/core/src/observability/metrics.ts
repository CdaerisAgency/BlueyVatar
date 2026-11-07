type Labels = Record<string, string | number>

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

function labelKey(labels?: Labels): string {
  if (!labels) return ''
  return Object.keys(labels).sort().map((k) => `${k}="${String(labels[k]).replace(/[\\"\n]/g, '_')}"`).join(',')
}

const METRIC_NAME = /^[a-z_][a-z0-9_]*$/

/**
 * Small in-process metrics registry that renders the Prometheus text format. Pick this over pushing
 * to Sentry: scraping needs no vendor, adds no request cost, and any Prometheus-compatible agent can read it.
 * Label values must come from small fixed sets (status class, outcome), never from user input.
 */
export class Metrics {
  private counters = new Map<string, Map<string, number>>()
  private gauges = new Map<string, Map<string, number>>()
  private hists = new Map<string, Map<string, { buckets: number[]; sum: number; count: number }>>()
  private help = new Map<string, string>()

  describe(name: string, help: string): void {
    this.help.set(name, help)
  }

  inc(name: string, labels?: Labels, by = 1): void {
    if (!METRIC_NAME.test(name)) return
    const m = this.counters.get(name) ?? new Map<string, number>()
    const k = labelKey(labels)
    m.set(k, (m.get(k) ?? 0) + by)
    this.counters.set(name, m)
  }

  set(name: string, value: number, labels?: Labels): void {
    if (!METRIC_NAME.test(name)) return
    const m = this.gauges.get(name) ?? new Map<string, number>()
    m.set(labelKey(labels), value)
    this.gauges.set(name, m)
  }

  /** Records a duration in milliseconds. */
  observe(name: string, ms: number, labels?: Labels): void {
    if (!METRIC_NAME.test(name)) return
    const m = this.hists.get(name) ?? new Map()
    const k = labelKey(labels)
    const h = m.get(k) ?? { buckets: DEFAULT_BUCKETS_MS.map(() => 0), sum: 0, count: 0 }
    DEFAULT_BUCKETS_MS.forEach((b, i) => { if (ms <= b) h.buckets[i]!++ })
    h.sum += ms
    h.count++
    m.set(k, h)
    this.hists.set(name, m)
  }

  /** Test helper: current counter value. */
  counter(name: string, labels?: Labels): number {
    return this.counters.get(name)?.get(labelKey(labels)) ?? 0
  }

  render(): string {
    const lines: string[] = []
    const head = (name: string, type: string) => {
      const h = this.help.get(name)
      if (h) lines.push(`# HELP ${name} ${h}`)
      lines.push(`# TYPE ${name} ${type}`)
    }
    const series = (name: string, k: string, v: number, extra = '') => {
      const l = [k, extra].filter(Boolean).join(',')
      lines.push(`${name}${l ? `{${l}}` : ''} ${v}`)
    }
    for (const [name, m] of this.counters) {
      head(name, 'counter')
      for (const [k, v] of m) series(name, k, v)
    }
    for (const [name, m] of this.gauges) {
      head(name, 'gauge')
      for (const [k, v] of m) series(name, k, v)
    }
    for (const [name, m] of this.hists) {
      head(name, 'histogram')
      for (const [k, h] of m) {
        DEFAULT_BUCKETS_MS.forEach((b, i) => series(`${name}_bucket`, k, h.buckets[i]!, `le="${b}"`))
        series(`${name}_bucket`, k, h.count, 'le="+Inf"')
        series(`${name}_sum`, k, h.sum)
        series(`${name}_count`, k, h.count)
      }
    }
    return lines.join('\n') + '\n'
  }
}

/** Status class label: 2xx, 3xx, 4xx, 5xx. */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`
}
