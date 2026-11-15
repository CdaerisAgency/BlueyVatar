/**
 * The short list behind the profile time zone picker: one entry for each distinct
 * combination of UTC offset and daylight-saving rule that people actually use.
 *
 * Only the picker is curated. The stored value is still an IANA name, and the server
 * (isValidTimezone in ./records) still accepts any valid IANA name written by other clients.
 *
 * `std` is the standard (non-daylight) offset in minutes. Entries are sorted by `std`,
 * then by `name`, so the list reads from west to east.
 */
export type ZoneEntry = { id: string; name: string; std: number }

export const TIMEZONE_ENTRIES: readonly ZoneEntry[] = [
  { id: 'Pacific/Pago_Pago', name: 'Samoa, Pago Pago', std: -660 },
  { id: 'Pacific/Honolulu', name: 'Hawaii, Honolulu', std: -600 },
  { id: 'America/Anchorage', name: 'Alaska, Anchorage', std: -540 },
  { id: 'America/Los_Angeles', name: 'Pacific Time, Los Angeles', std: -480 },
  { id: 'America/Phoenix', name: 'Arizona, Phoenix', std: -420 },
  { id: 'America/Denver', name: 'Mountain Time, Denver', std: -420 },
  { id: 'America/Chicago', name: 'Central Time, Chicago', std: -360 },
  { id: 'America/Mexico_City', name: 'Mexico City, Central America', std: -360 },
  { id: 'America/Bogota', name: 'Bogota, Lima, Panama', std: -300 },
  { id: 'America/New_York', name: 'Eastern Time, New York', std: -300 },
  { id: 'America/Halifax', name: 'Atlantic Time, Halifax', std: -240 },
  { id: 'America/Puerto_Rico', name: 'Puerto Rico, Caracas, La Paz', std: -240 },
  { id: 'America/Santiago', name: 'Santiago', std: -240 },
  { id: 'America/St_Johns', name: "Newfoundland, St. John's", std: -210 },
  { id: 'America/Sao_Paulo', name: 'Brasilia, Sao Paulo, Buenos Aires', std: -180 },
  { id: 'Atlantic/South_Georgia', name: 'Mid-Atlantic, South Georgia', std: -120 },
  { id: 'Atlantic/Azores', name: 'Azores', std: -60 },
  { id: 'Atlantic/Cape_Verde', name: 'Cape Verde', std: -60 },
  { id: 'UTC', name: 'Coordinated Universal Time, Reykjavik, Accra', std: 0 },
  { id: 'Europe/London', name: 'London, Dublin, Lisbon', std: 0 },
  { id: 'Europe/Paris', name: 'Central European Time, Paris, Berlin', std: 60 },
  { id: 'Africa/Lagos', name: 'West Africa, Lagos', std: 60 },
  { id: 'Europe/Athens', name: 'Eastern European Time, Athens, Helsinki', std: 120 },
  { id: 'Africa/Johannesburg', name: 'South Africa, Johannesburg', std: 120 },
  { id: 'Europe/Moscow', name: 'Moscow, Istanbul, Riyadh, Nairobi', std: 180 },
  { id: 'Asia/Tehran', name: 'Tehran', std: 210 },
  { id: 'Asia/Dubai', name: 'Dubai, Muscat', std: 240 },
  { id: 'Asia/Kabul', name: 'Kabul', std: 270 },
  { id: 'Asia/Karachi', name: 'Karachi, Tashkent', std: 300 },
  { id: 'Asia/Kolkata', name: 'Delhi, Mumbai, Colombo', std: 330 },
  { id: 'Asia/Kathmandu', name: 'Kathmandu', std: 345 },
  { id: 'Asia/Dhaka', name: 'Dhaka', std: 360 },
  { id: 'Asia/Yangon', name: 'Yangon', std: 390 },
  { id: 'Asia/Bangkok', name: 'Bangkok, Jakarta, Hanoi', std: 420 },
  { id: 'Asia/Singapore', name: 'Singapore, Shanghai, Perth, Manila', std: 480 },
  { id: 'Asia/Tokyo', name: 'Tokyo, Seoul', std: 540 },
  { id: 'Australia/Adelaide', name: 'Adelaide', std: 570 },
  { id: 'Australia/Darwin', name: 'Darwin', std: 570 },
  { id: 'Australia/Brisbane', name: 'Brisbane', std: 600 },
  { id: 'Australia/Sydney', name: 'Sydney, Melbourne', std: 600 },
  { id: 'Pacific/Noumea', name: 'Noumea, Solomon Islands', std: 660 },
  { id: 'Pacific/Auckland', name: 'Auckland, Wellington', std: 720 },
  { id: 'Pacific/Fiji', name: 'Fiji, Kamchatka', std: 720 },
  { id: 'Pacific/Chatham', name: 'Chatham Islands', std: 765 },
  { id: 'Pacific/Tongatapu', name: 'Tonga, Apia', std: 780 },
  { id: 'Pacific/Kiritimati', name: 'Kiritimati', std: 840 },
]

/** "+05:30" or "-03:00" for a number of minutes. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** The label shown in the picker, for example "(UTC-05:00) Eastern Time, New York". */
export function zoneLabel(e: ZoneEntry): string {
  return `(UTC${formatOffset(e.std)}) ${e.name}`
}

/** UTC offset of a zone in minutes at an instant. Returns null when the name is not a valid zone. */
export function offsetMinutes(zone: string, at: Date): number | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find((x) => x.type === 'timeZoneName')?.value ?? ''
    if (part === 'GMT') return 0
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part)
    if (!m) return null
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
  } catch {
    return null
  }
}

/**
 * The offset-plus-daylight-saving rule of a zone, as its January and July offsets in 2026
 * (a fixed year, so the answer never depends on today's date). Zones with the same signature
 * keep the same clock all year, to the minute.
 */
export function zoneSignature(zone: string): string | null {
  const jan = offsetMinutes(zone, new Date(Date.UTC(2026, 0, 1)))
  const jul = offsetMinutes(zone, new Date(Date.UTC(2026, 6, 1)))
  return jan === null || jul === null ? null : `${jan}/${jul}`
}

/** The list entry that shares a zone's clock all year, or null when the list has none. */
export function entryForZone(zone: string): ZoneEntry | null {
  const exact = TIMEZONE_ENTRIES.find((e) => e.id === zone)
  if (exact) return exact
  const sig = zoneSignature(zone)
  if (sig === null) return null
  return TIMEZONE_ENTRIES.find((e) => zoneSignature(e.id) === sig) ?? null
}

/** True when the picker lists this exact id. */
export const isListedZone = (zone: string): boolean => TIMEZONE_ENTRIES.some((e) => e.id === zone)
