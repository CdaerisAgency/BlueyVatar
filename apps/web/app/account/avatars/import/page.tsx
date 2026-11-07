import { PageMain } from '../../../../components/Page'
import { Button } from '../../../../components/Button'
import { requireDid } from '../../../../lib/auth'
import { loadImport, parseSourceParam } from '../../../../lib/import-load'
import { sourceLabel } from '../../../../lib/import'
import { RepoError, listImages, repoSession } from '../../../../lib/repo'
import { LICENSES, canAddImage, limitMessage } from '../../../../lib/records'
import { resolvePlan } from '../../../../lib/plan'
import { limited } from '../../../../lib/rate-guard'
import AccountNav from '../../AccountNav'
import { confirmImport } from './actions'

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
        <form action={confirmImport}>
          <input type="hidden" name="source" value={source} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.uri} alt="Preview of the image to import" width={160} height={160} className="object-cover" />
          <p>
            This image comes from {preview.label}. Confirm its rating and license before it is saved to your repository, where it will be public.
            {preview.suggested === null ? ' We cannot see how the image was rated, so choose a rating.' : ''}
          </p>
          <label>
            Rating{' '}
            <select name="rating" defaultValue={preview.suggested ?? ''} required>
              {preview.suggested === null && <option value="">Choose a rating</option>}
              <option value="g">G: suitable for all audiences</option>
              <option value="pg">PG: non-sexual nudity or mild content</option>
              <option value="r">R: sexually suggestive or graphic media</option>
              <option value="x">X: adult content</option>
            </select>
          </label>
          <label>
            If R, label as{' '}
            <select name="rLabel" defaultValue="sexual">
              <option value="sexual">Sexual</option>
              <option value="graphic-media">Graphic media</option>
            </select>
          </label>
          <label>
            License{' '}
            <select name="license" defaultValue="personal">
              {LICENSES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Alt text (up to 300 characters) <textarea name="alt" maxLength={3000} rows={2} />
          </label>
          <label>
            <input name="isDefault" type="checkbox" /> Use as my default image
          </label>
          <Button type="submit" variant="primary">Import</Button>
        </form>
      )}
      <p>
        <a href="/account/avatars">Back to avatars</a>
      </p>
    </PageMain>
  )
}
