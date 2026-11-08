# @blueyvatar/hovercards

Hovercards for blueyvatar profiles. Hover or focus an element with `data-blueyvatar` and a small card shows the person's name, role, location, and verified accounts. If the person set a background color, the card uses it, with dark or white text chosen for a 4.5 to 1 contrast ratio (the default colors apply when neither passes). Accounts the person chose to hide are never shown.

Hovercards require a publishable key (`pk_...`) from a Plus, Business, or Enterprise license.

Status: version 0.1.0 is not published yet. Publishing to npm is a later manual step. Until then, use the script served by the web app at `/embed/hovercard.js`, which is built from this package.

## Embed

Script tag (module):

```html
<script type="module" src="https://blueyvatar.com/embed/hovercard.js" data-key="pk_..."></script>

<img src="https://example.com/alice.png" alt="Alice" data-blueyvatar="alice.example.com">
```

The value of `data-blueyvatar` is a handle, a DID, or an email hash. Optional `data-api` sets the delivery origin (default: the script's origin). The classic form `<script src="..." data-token="pk_..." defer>` still works.

From npm, once published:

```js
import { init } from '@blueyvatar/hovercards'

const stop = init({ key: 'pk_...' }) // call stop() to remove the listeners
```

Or `import '@blueyvatar/hovercards/auto'` to read `data-key` from the page's script tag.

## Gating

The card reads `GET /profile/:id` from delivery with the key as a `token` query parameter. When a request carries an `Origin` header that is not the delivery service's own host or the profile site's host, delivery requires a key whose tier has hovercards (Plus, Business, or Enterprise). Other tiers, and requests without a key, get `403 tier_required`. Publishable keys also enforce their domain list (`origin_not_allowed`).

Same-origin requests and server-to-server requests with no `Origin` header are not gated by this check.

## Privacy

No cookies are sent or set, requests use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`, and all text is set with `textContent`.
