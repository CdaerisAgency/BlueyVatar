import type { LinkedEmailView } from '../../lib/linked-emails'

/** One linked email for the owner: the address (full when stored, masked for older links) and the hash behind "Details". */
export default function LinkedEmail({ item }: { item: LinkedEmailView }) {
  return (
    <>
      <span>{item.text}</span>
      {item.primary && <strong> primary</strong>}
      {!item.full && <small> (address not stored, link it again to show it)</small>}
      <details className="inline">
        <summary>Details</summary>
        <p>
          Linked by {item.method}. Hash: <code>{item.emailHash}</code>
        </p>
      </details>
    </>
  )
}
