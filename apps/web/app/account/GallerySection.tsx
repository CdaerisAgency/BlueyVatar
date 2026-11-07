import { GALLERY_CAPTION_MAX, GALLERY_MAX, ratingFromLabels } from '@blueyvatar/core'
import { Button } from '../../components/Button'
import { GALLERY_PLUS_MESSAGE, isPlus, listGallery } from '../../lib/gallery'
import { LICENSES } from '../../lib/records'
import { RepoError, blobUrl, imageLabels, pdsUrl, repoSession, type StoredImage } from '../../lib/repo'
import ImageFileInput from './avatars/ImageFileInput'
import { moveGallery, removeGalleryImage, uploadGalleryImage } from './galleryActions'

/** Account page Gallery section. Non-Plus users see one upsell line. */
export default async function GallerySection({ did, error, done }: { did: string; error?: string; done?: string }) {
  if (!isPlus(did)) {
    return (
      <section id="gallery">
        <h2>Gallery</h2>
        <p>{GALLERY_PLUS_MESSAGE} Upgrade to Plus to show up to {GALLERY_MAX} gallery images on your profile.</p>
      </section>
    )
  }
  let images: StoredImage[] = []
  let pds = ''
  let loadError: string | null = null
  try {
    const session = await repoSession(did)
    ;[images, pds] = await Promise.all([listGallery(session), pdsUrl(session)])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  const canAdd = !loadError && images.length < GALLERY_MAX
  return (
    <section id="gallery">
      <h2>
        Gallery ({images.length} of {GALLERY_MAX})
      </h2>
      <p>
        Gallery images are saved to your repository on your PDS and are public there. They appear on your profile page and never become your avatar.
      </p>
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {images.length === 0 && !loadError ? <p>No gallery images yet.</p> : null}
      <ul>
        {images.map((img, i) => (
          <li key={img.rkey} className="flex items-start gap-3">
            {/* The blob is served by the user's PDS, so next/image optimization does not apply. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={blobUrl(pds, did, img.value.image.ref.$link)} alt={img.value.alt ?? ''} width={96} height={96} className="size-24 rounded-bv-card border border-bv-line object-cover" referrerPolicy="no-referrer" />
            <div>
              <div>
                Position {i + 1}. Rating {ratingFromLabels(imageLabels(img)).toUpperCase()}, license {img.value.license ?? 'unset'}
              </div>
              {img.value.caption ? <div>{img.value.caption}</div> : null}
              <div className="mt-1 flex flex-wrap gap-2">
                {i > 0 && (
                  <form action={moveGallery}>
                    <input type="hidden" name="rkey" value={img.rkey} />
                    <input type="hidden" name="direction" value="up" />
                    <Button type="submit">Move up</Button>
                  </form>
                )}
                {i < images.length - 1 && (
                  <form action={moveGallery}>
                    <input type="hidden" name="rkey" value={img.rkey} />
                    <input type="hidden" name="direction" value="down" />
                    <Button type="submit">Move down</Button>
                  </form>
                )}
                <form action={removeGalleryImage}>
                  <input type="hidden" name="rkey" value={img.rkey} />
                  <Button type="submit">Delete</Button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <h3>Add a gallery image</h3>
      {canAdd ? (
        <form action={uploadGalleryImage} encType="multipart/form-data">
          <ImageFileInput />
          <label>
            Caption (up to {GALLERY_CAPTION_MAX} characters) <input name="caption" maxLength={GALLERY_CAPTION_MAX} />
          </label>
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
          <Button type="submit" variant="primary">Upload to gallery</Button>
        </form>
      ) : (
        !loadError && <p>The gallery holds up to {GALLERY_MAX} images. Delete one to add another.</p>
      )}
    </section>
  )
}
