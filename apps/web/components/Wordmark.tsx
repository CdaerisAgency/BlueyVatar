import { WORDMARK_NAME, WORDMARK_VISIBLE } from '../lib/wordmark'

/**
 * The logo type. It shows BlueyVa’tar, and assistive technology gets "BlueyVatar" because the visible text is
 * hidden from it and the wrapper is an image with that label. Use this for logo placements only.
 */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={WORDMARK_NAME} className={className}>
      <span aria-hidden="true">{WORDMARK_VISIBLE}</span>
    </span>
  )
}
