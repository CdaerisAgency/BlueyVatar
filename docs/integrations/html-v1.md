# Plain HTML (v1)

Use this guide for a static page, a template, or any site you edit by hand. For the full parameter list, see [the API reference](../api/README-v1.md).

## 1. Compute the hash

The API never accepts a raw email address, because a URL appears in server logs. Hash the address first: trim, lowercase, then SHA-256, written as 64 lowercase hex characters. See [hashing-v1.md](../api/hashing-v1.md) for JavaScript, Python, and shell versions.

For a page that shows one fixed person, compute the hash once when you build the page and paste it in. The account page in BlueyVatar shows the finished snippet for your own email.

```sh
printf '%s' 'ada@example.com' | tr '[:upper:]' '[:lower:]' | shasum -a 256 | cut -d' ' -f1
```

## 2. Add the image

```html
<img
  src="https://img.blueyvatar.com/avatar/HASH?s=96&amp;d=identicon&amp;r=g"
  width="96" height="96" alt="Ada Lovelace"
  referrerpolicy="no-referrer" loading="lazy">
```

- Route: `/avatar/{hash}` with a SHA-256 hash.
- Fallback: `d=identicon` is shown when the hash has no avatar. Other styles are `mp`, `monsterid`, `wavatar`, `retro`, `robohash`, `pagan`, `initials`, `blank`, and `404`. Use `404` when you want your own fallback image through an `onerror` handler.
- Rating: `r=g` limits the image to general audiences.
- Referrer: `referrerpolicy="no-referrer"` keeps the address of your page out of the request.
- Size: `s` is a square size in pixels. Your plan's cap applies.

The base URL is a placeholder until the final delivery host is announced. Keep it in one variable or template setting.

## 3. Hash in the browser

Only do this when the visitor types their own email on the page. Never put a list of other people's email addresses in page source.

```html
<script type="module">
  import { avatarUrl, emailHash } from 'https://esm.sh/@blueyvatar/avatar'
  const img = document.querySelector('#avatar')
  img.src = avatarUrl({ hash: await emailHash(emailInput.value), size: 96, default: 'identicon', rating: 'g' })
</script>
```

The package `@blueyvatar/avatar` has the same builder the WordPress plugin is tested against. It is not published to npm yet, so install it from the repository until the first release.

Spec reference: section 9 (embed guidance).
