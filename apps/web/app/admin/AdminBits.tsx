import type { ReactNode } from 'react'
import { policyList, canViewChildSafety, QUEUES } from '@blueyvatar/core/moderation'
import { Button } from '../../components/Button'
import { adminLogout } from './actions'

export const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '')

export function AdminNav({ did }: { did?: string }) {
  return (
    <nav aria-label="Admin" className="mb-4 flex flex-wrap items-center gap-4">
      <a href="/admin">Home</a>
      {QUEUES.filter((q) => q.name !== 'child_safety' || !did || canViewChildSafety(did)).map((q) => <a key={q.name} href={`/admin/queue/${q.name}`}>{q.label}</a>)}
      <a href="/admin/audit">Audit log</a>
      <form action={adminLogout} className="ml-auto"><Button type="submit">End admin session</Button></form>
    </nav>
  )
}

export function Msg({ text }: { text?: string }) {
  return text ? <p role="status">{text}</p> : null
}

/** The configured policy list. Every action cites one. */
export function PolicySelect({ idSuffix }: { idSuffix: string }) {
  return (
    <label>Policy cited (recorded in the audit log){' '}
      <select name="policy" required defaultValue="" id={`policy-${idSuffix}`}>
        <option value="" disabled>Choose a policy</option>
        {policyList().map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </label>
  )
}
