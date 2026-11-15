/** "Monday, December 25, 2028" for a YYYY-MM-DD date, or "December 25" with `withYear` off. Always UTC, so the day never shifts. Billing dates use longDate in lib/billing/summary, which takes a Date and has no weekday. */
export function longDate(date: string, withYear = true): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: withYear ? 'long' : undefined, year: withYear ? 'numeric' : undefined, month: 'long', day: 'numeric' })
}
