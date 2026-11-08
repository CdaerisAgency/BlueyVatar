'use client'

import { useState } from 'react'

/**
 * Rating select plus the "If R, label as" choice. The label choice is hidden (the `hidden` attribute, so assistive
 * technology skips it) unless R is chosen, and it resets when the rating changes. The server still validates.
 */
export default function RatingFields({ defaultRating = 'g', defaultRLabel = 'sexual', needsChoice = false, ratingError, rLabelError, idPrefix = 'rating' }: {
  defaultRating?: string
  defaultRLabel?: string
  needsChoice?: boolean
  ratingError?: string
  rLabelError?: string
  idPrefix?: string
}) {
  const [rating, setRating] = useState(defaultRating)
  const [rLabel, setRLabel] = useState(defaultRLabel)
  return (
    <>
      <label>
        Rating{' '}
        <select
          id={`${idPrefix}-rating`}
          aria-invalid={ratingError ? true : undefined}
          aria-describedby={ratingError ? `${idPrefix}-rating-error` : undefined}
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
        {ratingError && <span id={`${idPrefix}-rating-error`} className="field-error">{ratingError}</span>}
      </label>
      <label hidden={rating !== 'r'}>
        If R, label as{' '}
        <select id={`${idPrefix}-rLabel`} aria-invalid={rLabelError ? true : undefined} aria-describedby={rLabelError ? `${idPrefix}-rLabel-error` : undefined} name="rLabel" value={rLabel} disabled={rating !== 'r'} onChange={(e) => setRLabel(e.target.value)}>
          <option value="sexual">Sexual</option>
          <option value="graphic-media">Graphic media</option>
        </select>
        {rLabelError && <span id={`${idPrefix}-rLabel-error`} className="field-error">{rLabelError}</span>}
      </label>
    </>
  )
}
