# @blueyvatar/avatar

Avatar URL builder, email hashing, a Gravatar migration helper, and an optional React component for BlueyVatar. It has no server dependencies and runs in browsers and Node 18 or newer.

Status: version 0.1.0 is not published yet. Publishing is a manual, tag-triggered step (see docs/deploy.md, "Publish the npm packages").

## Install

```sh
npm install @blueyvatar/avatar
```

## Usage

```js
import { avatarUrl, emailHash, profileUrl } from '@blueyvatar/avatar'

const hash = await emailHash('Ada@Example.com') // SHA-256 of the trimmed, lowercased email

avatarUrl({ hash, size: 128, default: 'identicon', rating: 'g', format: 'webp', quality: 80, key: 'pk_...' })
avatarUrl({ handle: 'alice.example.com', size: 64 })
avatarUrl({ did: 'did:plc:abc123' })
profileUrl({ id: 'alice.example.com', key: 'pk_...' }) // profile JSON endpoint
```

Options: `hash` (SHA-256 or MD5 hex), `handle`, `did` (exactly one), `size` (1 to 2048), `default` (a style or an HTTPS URL), `forceDefault`, `rating` (`g`, `pg`, `r`, `x`), `format` (`png`, `jpeg`, `webp`), `quality` (1 to 100), `key`, `name`, `baseUrl` (default `https://img.blueyvatar.com`, which is not final). Raw email addresses are never sent: hash them first.

### React

```jsx
import { Avatar } from '@blueyvatar/avatar/react'

<Avatar hash={hash} size={48} alt="Ada" publishableKey="pk_..." />
```

The component renders an `img` with `referrerPolicy="no-referrer"` and `loading="lazy"` by default. Override either with props. React 18 or newer is an optional peer dependency. The key prop is `publishableKey`, because React reserves `key`.

### Moving from Gravatar

```js
import { avatarUrl, fromGravatarUrl } from '@blueyvatar/avatar'

const { options, notes } = fromGravatarUrl('https://gravatar.com/avatar/<hash>?s=200&d=mm&r=pg')
const url = avatarUrl(options) // notes lists the differences
```

`s`, `d`, `r`, and `f` are mapped (`d=mm` becomes `mp`). `d=color` is dropped. Ratings differ: Gravatar rates images by its own rules, and BlueyVatar derives the rating from atproto self-labels, so the same image can rate differently. See docs/api/gravatar-differences-v1.md.

## Size and tiers

The package is a few kilobytes with no runtime dependencies. Server tiers still apply to the URLs it builds: the Free tier serves PNG only and caps size at 512, custom `default` URLs need Plus or higher, and a publishable key is needed for tier features. The server clamps or ignores values and reports them in `x-adjusted-params`.

## Versioning policy

Semantic versioning. Before 1.0, a minor bump can change the API and a patch bump never does. The URL scheme follows the delivery API v1 (docs/api): new optional parameters arrive in a minor release, and a removed or renamed parameter needs a major release.
