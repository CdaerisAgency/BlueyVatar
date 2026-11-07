import { ratingFromLabels } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { currentDid } from '../../../lib/auth'
import { RepoError, blobUrl, imageLabels, listImages, pdsUrl, repoSession, type StoredImage } from '../../../lib/repo'
import { LICENSES, canAddImage, imageLimit, planFor } from '../../../lib/records'
import { getStore } from '../../../lib/store'
import AccountNav from '../AccountNav'
import ImageFileInput from './ImageFileInput'
import { makeDefault, removeImage, uploadImage } from './actions'

export const dynamic = 'force-dynamic'

export default async function AvatarsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await currentDid()
  if (!did) redirect('/login')
  const { error, done } = await searchParams
  const plan = planFor(did)
  let images: StoredImage[] = []
  let pds = ''
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[images, pds] = await Promise.all([listImages(session), pdsUrl(session)])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const links = await getStore().links.list(did).catch(() => [])
  const canAdd = !loadError && canAddImage(images.length, plan)

  return (
    <main>
      <AccountNav />
      <h1>Avatars</h1>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}

      <h2>
        Your images ({images.length} of {imageLimit(plan)})
      </h2>
      {images.length === 0 && !loadError ? <p>No images yet.</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16 }}>
        {images.map((img) => {
          const isDefault = img.value.isDefault === true
          return (
            <li key={img.rkey} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* The blob is served by the user's PDS, so next/image optimization does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={blobUrl(pds, did, img.value.image.ref.$link)} alt={img.value.alt ?? ''} width={96} height={96} style={{ objectFit: 'cover' }} referrerPolicy="no-referrer" />
              <div>
                <div>
                  {isDefault ? <strong>Default</strong> : null} Rating {ratingFromLabels(imageLabels(img)).toUpperCase()}, license {img.value.license ?? 'unset'}
                </div>
                {img.value.alt ? <div>{img.value.alt}</div> : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {!isDefault && (
                    <form action={makeDefault}>
                      <input type="hidden" name="rkey" value={img.rkey} />
                      <button type="submit">Set as default</button>
                    </form>
                  )}
                  <form action={removeImage}>
                    <input type="hidden" name="rkey" value={img.rkey} />
                    <button type="submit">Delete</button>
                  </form>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <h2>Import an image</h2>
      {canAdd ? (
        <>
          <p>Copy an avatar you already use into your repository. You preview the image and confirm its rating and license before anything is saved. The image must be PNG or JPEG and at most 1,000,000 bytes.</p>
          <ul>
            <li>
              <a href="/account/avatars/import?source=bluesky">Import my Bluesky profile avatar</a>
            </li>
            {links.map((l) => (
              <li key={l.emailHash}>
                Linked email {l.emailHash.slice(0, 8)}: <a href={`/account/avatars/import?source=gravatar:${l.emailHash}`}>Gravatar</a>,{' '}
                <a href={`/account/avatars/import?source=libravatar:${l.emailHash}`}>Libravatar</a>
              </li>
            ))}
          </ul>
          {links.length === 0 && <p>Link an email address on the Account page to import from Gravatar or Libravatar.</p>}
        </>
      ) : (
        !loadError && <p>Importing needs a free image slot.</p>
      )}

      <h2>Upload an image</h2>
      <p>
        Everything you save here is written to your repository on your PDS, and all data in an atproto repository is public today. The visibility rules you set here only
        apply to what this service serves. An avatar blob stays readable from your PDS regardless of those rules, and copies that others already hold cannot be recalled. If
        you need real access control, this service cannot provide it for repository images.
      </p>
      {canAdd ? (
        <form action={uploadImage} encType="multipart/form-data" style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
          <ImageFileInput />
          <label>
            Alt text (up to 300 characters) <textarea name="alt" maxLength={3000} rows={2} />
          </label>
          <label>
            Rating{' '}
            <select name="rating" defaultValue="g">
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
            <input name="isDefault" type="checkbox" /> Use as my default image
          </label>
          <button type="submit">Upload</button>
        </form>
      ) : (
        !loadError && <p>You have reached the {imageLimit(plan)} image limit for the Free plan. Delete an image to add another.</p>
      )}
    </main>
  )
}
