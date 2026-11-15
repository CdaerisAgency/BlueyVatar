import { ButtonLink } from '../../components/Button'
import { Section } from '../../components/Page'
import { imgSnippet, markdownSnippet } from '../../lib/avatar-snippets'
import CopyField from './CopyField'

/** How apps see the avatar for the primary email, with copyable embed snippets. */
export function AvatarUrlSection({ url, avatarCount }: { url: string | null; avatarCount: number | null }) {
  return (
    <Section title="Your avatar URL" id="preview">
      {url ? (
        <>
          <p>This is how apps see the avatar for your primary email.</p>
          <div className="flex items-center gap-3">
            {avatarCount === 0 ? (
              <span className="flex size-20 items-center justify-center rounded-full border border-solid border-bv-line text-sm" role="img" aria-label="No avatar yet">
                No avatar
              </span>
            ) : (
              // Served by the delivery host, so next/image optimization does not apply. The square size comes from the class, not fixed attributes.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Your current avatar" className="size-20 rounded-full object-cover" referrerPolicy="no-referrer" />
            )}
            <ButtonLink href="/account/avatars" variant="primary">Change your avatar</ButtonLink>
          </div>
          {avatarCount === 0 && <p>You have not added an avatar here yet. Until you do, apps that ask for this link get the avatar on your profile if you have one, or a default avatar.</p>}
          <CopyField label="URL" value={url} />
          <CopyField label="HTML" value={imgSnippet(url)} />
          <CopyField label="Markdown" value={markdownSnippet(url)} />
        </>
      ) : (
        <p>Link an email above to get a preview and embed snippets.</p>
      )}
    </Section>
  )
}
