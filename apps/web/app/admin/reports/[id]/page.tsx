import { notFound, redirect } from 'next/navigation'
import { syncCases } from '@blueyvatar/core/moderation'
import { requireAdmin } from '../../../../lib/admin/guard'

/** Reports are worked as cases now. This keeps old links working by sending them to the case that holds the report. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { pool } = await requireAdmin()
  const id = Number((await params).id)
  if (!Number.isSafeInteger(id)) return notFound()
  await syncCases(pool)
  const { rows } = await pool.query<{ case_id: number }>('SELECT case_id::int AS case_id FROM case_signals WHERE report_id = $1', [id])
  return rows[0] ? redirect(`/admin/cases/${rows[0].case_id}`) : notFound()
}
