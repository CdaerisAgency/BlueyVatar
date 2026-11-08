import { PageMain } from '../../../../components/Page'
import { requireDid } from '../../../../lib/auth'
import { loadImport, parseSourceParam } from '../../../../lib/import-load'
import { sourceLabel } from '../../../../lib/import'
import { RepoError, listImages, repoSession } from '../../../../lib/repo'
import { canAddImage, limitMessage } from '../../../../lib/records'
import { resolvePlan } from '../../../../lib/plan'
import { limited } from '../../../../lib/rate-guard'
import AccountNav from '../../AccountNav'
import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ source?: string; error?: string }> }) {
  const did = await requireDid('/account/avatars/import')
  const { source = '', error } = await searchParams
  const parsed = parseSourceParam(source)
  let problem: string | null = parsed ? null : 'Unknown import source.'
  let preview: { uri: string; suggested: string | null; label: string } | null = null
  const wait = parsed ? await limited(['import.did', 'import.ip'], did) : null
  if (wait) problem = wait
  if (parsed && !wait) {
    try {
      const plan = await resolvePlan(did)
      if (!canAddImage((await listImages(await repoSession(did))).length, plan)) throw new RepoError(limitMessage(plan))
      const img = await loadImport(did, source)
      preview = { uri: `data:${img.mime};base64,${Buffer.from(img.bytes).toString('base64')}`, suggested: img.suggested, label: sourceLabel(img.source) }
    } catch (err) {
      problem = err instanceof RepoError ? err.message : 'Could not fetch that image.'
    }
  }

  return (
    <PageMain>
      <AccountNav />
      <h1>Import an avatar</h1>
      {error && <p role="alert">{error}</p>}
      {problem && <p role="alert">{problem}</p>}
      {preview && (
        <ImportForm source={source} previewUri={preview.uri} label={preview.label} suggested={preview.suggested} />
      )}
      <p>
        <a href="/account/avatars">Back to avatars</a>
      </p>
    </PageMain>
  )
}
