import type { LinkedEmailView } from '../../lib/linked-emails'

/** One linked email for the owner: the address (full for the primary, masked for others) and the hash behind "Details". */
export default function LinkedEmail({ item }: { item: LinkedEmailView }) {
  return (
    <>
      <span>{item.text}</span>
      {item.primary && <strong> primary</strong>}
      <details className="inline">
        <summary>Details</summary>
        <p>
          Linked by {item.method}. Hash: <code>{item.emailHash}</code>
        </p>
      </details>
    </>
  )
}
