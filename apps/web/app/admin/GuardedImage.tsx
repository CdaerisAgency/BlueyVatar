'use client'

import { useState } from 'react'
import { Button } from '../../components/Button'
import { revealAction, saveWellnessAction } from './actions'

/**
 * An image under review. It starts blurred and grayscale (the reviewer's saved settings). The reviewer can change the blur
 * strength and grayscale for this view, save them as their defaults, and click Reveal, which is written to the audit log
 * before the blur is removed. Grayscale stays on if the reviewer chose it. There is no audio and no autoplay.
 */
export function GuardedImage({ caseId, cid, rating, initialBlur, initialGrayscale, backTo }: {
  caseId: number; cid: string; rating: string; initialBlur: number; initialGrayscale: boolean; backTo: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [blur, setBlur] = useState(initialBlur)
  const [gray, setGray] = useState(initialGrayscale)
  const [problem, setProblem] = useState('')
  const filter = [!revealed && blur > 0 ? `blur(${blur}px)` : '', gray ? 'grayscale(1)' : ''].filter(Boolean).join(' ') || 'none'

  async function reveal() {
    setProblem('')
    try {
      if (await revealAction(caseId, cid)) setRevealed(true)
      else setProblem('The reveal could not be logged, so the image stays hidden. Reopen the case.')
    } catch {
      setProblem('The reveal could not be logged, so the image stays hidden.')
    }
  }

  return (
    <figure className="m-0 grid gap-2">
      <div className="overflow-hidden rounded-lg border-[1.5px] border-bv-line" style={{ maxWidth: 320 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/admin/cases/${caseId}/image?cid=${encodeURIComponent(cid)}`} alt={revealed ? 'Image under review' : 'Image under review, hidden by blur'}
          referrerPolicy="no-referrer" width={320} height={320} style={{ display: 'block', width: '100%', height: 'auto', filter }}
        />
      </div>
      <figcaption>
        <code>{cid}</code>, rating {rating.toUpperCase()}
      </figcaption>
      <div className="flex flex-wrap items-center gap-3">
        {revealed
          ? <Button type="button" onClick={() => setRevealed(false)}>Hide again</Button>
          : <Button type="button" variant="primary" onClick={reveal}>Reveal image</Button>}
        <label>Blur{' '}
          <input type="range" min={0} max={40} value={blur} onChange={(e) => setBlur(Number(e.target.value))} aria-label="Blur strength" />
        </label>
        <label><input type="checkbox" checked={gray} onChange={(e) => setGray(e.target.checked)} /> Grayscale</label>
      </div>
      {problem && <p role="alert">{problem}</p>}
      <form action={saveWellnessAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="blur" value={blur} />
        {gray && <input type="hidden" name="grayscale" value="on" />}
        <input type="hidden" name="back" value={backTo} />
        <Button type="submit">Save as my default</Button>
      </form>
    </figure>
  )
}
