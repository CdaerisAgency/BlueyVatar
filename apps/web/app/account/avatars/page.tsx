import { EmptyState, PageHeader, PageMain, Section } from '../../../components/Page'
import { Button, ButtonLink } from '../../../components/Button'
import { ratingFromLabels } from '@blueyvatar/core'
import { redirect } from 'next/navigation'
import { requireDid } from '../../../lib/auth'
import { RepoError, blobUrl, blueskyAvatarCid, imageLabels, listImages, pdsUrl, repoSession, type StoredImage } from '../../../lib/repo'
import { canAddImage, imageLimit, limitMessage, uploadNotice } from '../../../lib/records'
import { resolvePlan } from '../../../lib/plan'
import { getStore } from '../../../lib/store'
import { describeLinkedEmails, readPrimaryAddress } from '../../../lib/linked-emails'
import ImageFileInput from './ImageFileInput'
import RatingFields from './RatingFields'
import UsePushAvatar from './UsePushAvatar'
import PushNotices from '../../integrations/PushNotices'
import { PUSH_APPS, type PushApp } from '../../../lib/push-apps'
import { hasPushPermission, pushBlockReason } from '../../../lib/push-sync'
import { getPushStore, type PushState } from '../../../lib/push-store'
import { consentOpen } from '../../../lib/push-status'
import LinkedEmail from '../LinkedEmail'
import { makeDefault, removeImage, uploadImage } from './actions'

export const dynamic = 'force-dynamic'

export default async function AvatarsPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const did = await requireDid('/account/avatars')
  const store = getPushStore()
  const { error, done } = await searchParams
  const plan = await resolvePlan(did)
  let images: StoredImage[] = []
  let pds = ''
  let bskyCid: string | null = null
  let loadError: string | null = null
  let pushApps: { app: PushApp; state: PushState }[] = []
  try {
    const session = await repoSession(did)
    // Apps whose permission this session holds. The buttons below push to those, and nothing else changes here.
    for (const app of PUSH_APPS) if (await hasPushPermission(session, app)) pushApps.push({ app, state: await store.get(did, app.id) })
    ;[images, pds, bskyCid] = await Promise.all([listImages(session), pdsUrl(session), blueskyAvatarCid(session).catch(() => null)])
  } catch (err) {
    loadError = err instanceof RepoError ? err.message : 'Could not read your repository.'
  }
  // The permission screen for an app on the Integrations page returns here: send the user back to finish the last step there.
  if (pushApps.some(({ state }) => !state.enabled && consentOpen(state))) redirect('/integrations')
  const links = await getStore().links.list(did).catch(() => [])
  const emails = describeLinkedEmails(links, readPrimaryAddress(await getStore().links.noticeAddress(did).catch(() => undefined)))
  const canAdd = !loadError && canAddImage(images.length, plan)

  return (
    <PageMain>
      <PageHeader title="Avatars" intro="Upload, import, and choose the images apps show for you." />
      {error && <p role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {loadError && <p role="alert">{loadError}</p>}

      <PushNotices items={pushApps} from="avatars" />
      <p>
        Choose which apps get your default image as their profile picture on the <a href="/integrations">Integrations page</a>.
      </p>

      <Section title={`Your images (${images.length} of ${imageLimit(plan)})`}>
      {canAdd ? (
        <p>
          <ButtonLink href="#upload" variant="primary">Upload an image</ButtonLink>
        </p>
      ) : (
        !loadError && (
          <p>
            <Button type="button" variant="primary" disabled>Upload an image</Button> {limitMessage(plan)}
          </p>
        )
      )}
      {images.length === 0 && !loadError ? <EmptyState action={canAdd ? { href: '#upload', label: 'Upload an image' } : undefined}>You have no avatar yet. The first image you add becomes your default.</EmptyState> : null}
      {!loadError && (
        <div className="flex items-start gap-3">
          {bskyCid ? (
            <>
              {/* The blob is served by the user's home server, so next/image optimization does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={blobUrl(pds, did, bskyCid)} alt="Your profile avatar" className="size-24 object-cover" referrerPolicy="no-referrer" />
              <div>
                <div>Your profile avatar{images.length === 0 ? ' (currently shown)' : ''}</div>
                {canAdd && (
                  <p>
                    <ButtonLink href="/account/avatars/import?source=bluesky">Use this as my BlueyVatar avatar</ButtonLink>
                  </p>
                )}
                <p>Profile avatars accept up to 1,000,000 bytes, and BlueyVatar accepts up to 5 MiB, so BlueyVatar shrinks a large image when you send it to your profile.</p>
              </div>
            </>
          ) : (
            <p>Your profile has no avatar.</p>
          )}
        </div>
      )}
      <ul>
        {images.map((img) => {
          const isDefault = img.value.isDefault === true
          return (
            <li key={img.rkey} className="flex items-start gap-3">
              {/* The blob is served by the user's home server, so next/image optimization does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={blobUrl(pds, did, img.value.image.ref.$link)} alt={img.value.alt ?? ''} width={96} height={96} className="object-cover" referrerPolicy="no-referrer" />
              <div>
                <div>
                  {isDefault ? <strong>Default</strong> : null} Rating {ratingFromLabels(imageLabels(img)).toUpperCase()}
                </div>
                {img.value.alt ? <div>{img.value.alt}</div> : null}
                <div className="mt-1 flex gap-2">
                  {!isDefault && (
                    <form action={makeDefault}>
                      <input type="hidden" name="rkey" value={img.rkey} />
                      <Button type="submit">Set as default</Button>
                    </form>
                  )}
                  {pushApps.map(({ app }) => (
                    <UsePushAvatar key={app.id} rkey={img.rkey} app={app} blockedReason={pushBlockReason(img)} />
                  ))}
                  <form action={removeImage}>
                    <input type="hidden" name="rkey" value={img.rkey} />
                    <Button type="submit" variant="danger">Delete</Button>
                  </form>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      </Section>

      <Section title="Import an image">
      {canAdd ? (
        <>
          <p>Copy an avatar you already use into your repository. The image must be PNG or JPEG and at most 5 MB. Images above 4096 pixels on the long side are shrunk to fit.</p>
          <ul>
            <li>
              <a href="/account/avatars/import?source=bluesky">Import my profile avatar</a>
            </li>
            {links.map((l, i) => (
              <li key={l.emailHash}>
                <LinkedEmail item={emails[i]!} />: <a href={`/account/avatars/import?source=gravatar:${l.emailHash}`}>Gravatar</a>,{' '}
                <a href={`/account/avatars/import?source=libravatar:${l.emailHash}`}>Libravatar</a>
              </li>
            ))}
          </ul>
          {links.length === 0 && <p>Link an email address on the Account page to import from Gravatar or Libravatar.</p>}
        </>
      ) : (
        !loadError && <p>Importing needs a free image slot.</p>
      )}
      </Section>

      <Section title="Upload an image" id="upload" intro={uploadNotice(plan)}>
      {canAdd ? (
        <form action={uploadImage} encType="multipart/form-data">
          <ImageFileInput />
          <label>
            Alt text (up to 300 characters) <textarea name="alt" maxLength={3000} rows={2} />
          </label>
          <RatingFields />
          <label>
            <input name="isDefault" type="checkbox" /> Use as my default image
          </label>
          <Button type="submit" variant="primary">Upload</Button>
        </form>
      ) : (
        !loadError && <p>{limitMessage(plan)}</p>
      )}
      </Section>
    </PageMain>
  )
}
