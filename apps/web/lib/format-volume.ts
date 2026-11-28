/** "1,000", "50,000", "1 million", "2.5 million". Pure, so client and server code can both import it. */
export function formatVolume(n: number): string {
  if (n >= 1_000_000) {
    const m = Math.round((n / 1_000_000) * 10) / 10
    return `${Number.isInteger(m) ? m : m.toFixed(1)} million`
  }
  return n.toLocaleString('en-US')
}
