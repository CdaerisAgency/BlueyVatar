'use client'

import { useState } from 'react'

/** A read-only snippet with a Copy button. Falls back to selecting the text when the clipboard is unavailable. */
export default function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <div>
      <label>
        {label}
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
      </label>{' '}
      <button type="button" onClick={copy} className="cursor-pointer rounded-full border-[1.5px] border-bv-black bg-transparent px-4 py-1 text-[15px] font-semibold">
        Copy
      </button>{' '}
      <span role="status">{state === 'copied' ? 'Copied.' : state === 'failed' ? 'Copy failed. Select the text and copy it.' : ''}</span>
    </div>
  )
}
