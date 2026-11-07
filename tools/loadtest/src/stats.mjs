/** Percentile by nearest rank over a sorted copy. Returns null for an empty sample. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(sorted.length, rank) - 1]
}

export function summarize(values) {
  const s = Float64Array.from(values).sort()
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.length ? s[s.length - 1] : null }
}
