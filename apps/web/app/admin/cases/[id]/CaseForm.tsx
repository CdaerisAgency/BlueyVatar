import type { ReactNode } from 'react'
import { SOR_TEMPLATES } from '@blueyvatar/core/verification'
import { Button } from '../../../../components/Button'
import { REASON_LABELS, type Reason } from '../../../../lib/reports'
import type { CaseAction } from '../../../../lib/admin/case-actions'
import type { CaseDetail } from '../../../../lib/admin/case-detail'
import { caseAction } from '../../actions'
import { PolicySelect } from '../../AdminBits'

const label = (k: string) => REASON_LABELS[k as Reason] ?? k

export function defaultFacts(d: CaseDetail): string {
  const reports = d.signals.filter((s) => s.kind === 'report')
  const auto = d.signals.filter((s) => s.kind === 'scanner' || s.kind === 'label')
  const parts: string[] = []
  if (reports.length) parts.push(`We received ${reports.length} report${reports.length === 1 ? '' : 's'} (${[...new Set(reports.map((r) => label(r.category)))].join(', ')}).`)
  if (auto.length) parts.push(`An automated check flagged the content (${[...new Set(auto.map((s) => `${s.kind}: ${s.source ?? s.category}`))].join(', ')}).`)
  return parts.join(' ')
}

export function CaseForm({ id, action, title, children, notice }: { id: number; action: CaseAction; title: string; children?: ReactNode; notice?: { facts: string } }) {
  const t = notice ? SOR_TEMPLATES[action as keyof typeof SOR_TEMPLATES] : null
  return (
    <form action={caseAction} aria-label={title}>
      <h3>{title}</h3>
      <input type="hidden" name="case" value={id} />
      <input type="hidden" name="action" value={action} />
      {children}
      {notice && (
        <>
          <label>Facts for the account owner (what we saw, in plain words)
            <textarea name="facts" required rows={3} maxLength={800} defaultValue={notice.facts} />
          </label>
          {action !== 'reverse' && (
            <label>Why this breaks the policy, for the account owner
              <textarea name="explanation" required rows={2} maxLength={600} />
            </label>
          )}
          <details><summary>What the account owner receives</summary><pre className="whitespace-pre-wrap">{t?.body}</pre><p>The action is blocked if any field in this notice is empty.</p></details>
        </>
      )}
      <label>Reason (internal, recorded in the audit log) <input name="reason" required maxLength={500} autoComplete="off" /></label>
      <PolicySelect idSuffix={`${action}-${id}`} />
      <Button type="submit">{title}</Button>
    </form>
  )
}
