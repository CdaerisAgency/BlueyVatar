'use client'

import { useEffect, useState } from 'react'

/** The time zone field. When nothing is saved yet, it fills in the browser's zone after load. Works as a plain text field without script. */
export function TimezoneInput({ saved, fallback }: { saved: string | null; fallback: string }) {
  const [value, setValue] = useState(saved ?? fallback)
  useEffect(() => {
    if (saved) return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) setValue(tz)
    } catch {
      /* keep the fallback */
    }
  }, [saved])
  return <input type="text" name="timezone" id="schedule-timezone" required value={value} onChange={(e) => setValue(e.target.value)} />
}
