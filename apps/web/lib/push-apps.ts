/**
 * The apps that blueyvatar can push your default image to (issue #298).
 *
 * ADDING AN APP is one entry in PUSH_APPS below, plus its test case in push-apps.test.ts. Nothing else changes:
 * the integrations page, the consent step, the permission check, the image shrinking, and the push all read
 * this list. Each entry needs four facts, taken from the app's published lexicon and never guessed:
 *
 *   collection  the NSID of the profile record. The record key must be `self` (`literal:self` in the lexicon),
 *               and `avatar` must be an optional blob field. A record with only `$type` and `avatar` must be valid.
 *   avatar      the lexicon's blob limits: `maxBytes` (maxSize) and `mimes` (accept, or PNG and JPEG when the
 *               lexicon lists none).
 *   source      the URL of the lexicon file you read, so the next person can check it.
 *   reach       one plain sentence on which apps show the picture, shown on the page.
 *
 * The permission is derived from `collection` (`profileWriteScope` in oauth.ts), and the metadata scope list
 * follows from the entries, so there is no separate scope to edit. Permission sets cannot span namespaces, so
 * every app is its own consent step. See docs/integrations-push-v1.md for the full checklist.
 */
export interface PushApp {
  id: string
  name: string
  url: string
  /** NSID of the profile record. Record key `self`. */
  collection: string
  avatar: { maxBytes: number; mimes: readonly ('image/png' | 'image/jpeg')[] }
  /** The published lexicon these facts come from. */
  source: string
  /** Plain words: where the picture shows up. */
  reach: string
  /** An extra line shown on the row, or empty. */
  note: string
}

export const PUSH_APPS: readonly PushApp[] = [
  {
    id: 'bluesky',
    name: 'Bluesky',
    url: 'https://bsky.app',
    collection: 'app.bsky.actor.profile',
    avatar: { maxBytes: 1_000_000, mimes: ['image/png', 'image/jpeg'] },
    source: 'https://github.com/bluesky-social/atproto/blob/fe343a1b90c1de470a45b0469628a9e75e7d883f/packages/pds/lexicons/app/bsky/actor/profile.json',
    reach: 'Bluesky and the other apps that read the Bluesky profile.',
    note: 'Tangled also shows this picture when you have not set one in Tangled.',
  },
  {
    id: 'tangled',
    name: 'Tangled',
    url: 'https://tangled.org',
    collection: 'org.tangled.actor.profile',
    // The lexicon sets maxSize 1000000 and lists no accepted types, so PNG and JPEG are sent.
    avatar: { maxBytes: 1_000_000, mimes: ['image/png', 'image/jpeg'] },
    source: 'https://tangled.org/tangled.org/core/raw/master/lexicons/org/tangled/actor/profile.json',
    reach: 'Tangled profiles, repositories, issues and pull requests.',
    note: 'Tangled uses its own profile record. A picture set here takes the place of the Bluesky picture on Tangled.',
  },
]

export const pushApp = (id: string): PushApp | undefined => PUSH_APPS.find((a) => a.id === id)

/** "1 MB" for 1,000,000 bytes, as the lexicons count them (decimal). */
export const limitLabel = (bytes: number): string => (bytes % 1_000_000 === 0 ? `${bytes / 1_000_000} MB` : `${Math.round(bytes / 1000)} KB`)
