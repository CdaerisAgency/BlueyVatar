import type { ReactNode } from 'react'
import { Button } from '../../components/Button'
import { adminLogout } from './actions'

export const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '')

export function AdminNav() {
  return (
    <nav aria-label="Admin" className="mb-4 flex flex-wrap items-center gap-4">
      <a href="/admin">Reports and appeals</a>
      <a href="/admin/audit">Audit log</a>
      <form action={adminLogout} className="ml-auto"><Button type="submit">End admin session</Button></form>
    </nav>
  )
}

export function Msg({ text }: { text?: string }) {
  return text ? <p role="status">{text}</p> : null
}

export function ReasonForm({ action, label, fields, children }: { action: (f: FormData) => Promise<void>; label: string; fields: Record<string, string | number>; children?: ReactNode }) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
      <label>Reason (recorded in the audit log){' '}
        <input name="reason" required maxLength={500} autoComplete="off" />
      </label>
      {children}
      <Button type="submit">{label}</Button>
    </form>
  )
}
