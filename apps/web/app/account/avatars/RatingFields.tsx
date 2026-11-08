'use client'

import { useState } from 'react'

/**
 * Rating select plus the "If R, label as" choice. The label choice is hidden (the `hidden` attribute, so assistive
 * technology skips it) unless R is chosen, and it resets when the rating changes. The server still validates.
 */
export default function RatingFields({ defaultRating = 'g', needsChoice = false }: { defaultRating?: string; needsChoice?: boolean }) {
  const [rating, setRating] = useState(defaultRating)
  const [rLabel, setRLabel] = useState('sexual')
  return (
    <>
      <label>
        Rating{' '}
        <select
          name="rating"
          value={rating}
          required={needsChoice}
          onChange={(e) => {
            setRating(e.target.value)
            setRLabel('sexual')
          }}
        >
          {needsChoice && <option value="">Choose a rating</option>}
          <option value="g">G: suitable for all audiences</option>
          <option value="pg">PG: non-sexual nudity or mild content</option>
          <option value="r">R: sexually suggestive or graphic media</option>
          <option value="x">X: adult content</option>
        </select>
      </label>
      <label hidden={rating !== 'r'}>
        If R, label as{' '}
        <select name="rLabel" value={rLabel} disabled={rating !== 'r'} onChange={(e) => setRLabel(e.target.value)}>
          <option value="sexual">Sexual</option>
          <option value="graphic-media">Graphic media</option>
        </select>
      </label>
    </>
  )
}
