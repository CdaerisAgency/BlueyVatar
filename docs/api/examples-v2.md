# Copy-paste examples (v1)

All examples use the proposed delivery host `https://img.blueyvatar.com`. Keep it in one configurable constant. The machine-readable description is at [`/openapi.json`](https://img.blueyvatar.com/openapi.json).

Compute the hash on the client. See [hashing-v1.md](hashing-v1.md).

## curl

Avatar by handle, following the redirect:

```sh
curl -L "https://img.blueyvatar.com/u/chris.cdaeris.com?s=128&r=pg" -o avatar.png
```

Avatar by email hash, with a key sent in a header:

```sh
HASH=$(printf '%s' 'ada@example.com' | tr '[:upper:]' '[:lower:]' | shasum -a 256 | cut -d' ' -f1)
curl -L -H "x-api-key: $BLUEYVATAR_KEY" "https://img.blueyvatar.com/avatar/$HASH?s=256&fmt=webp&q=85"
```

JSON metadata, with rate-limit headers:

```sh
curl -i "https://img.blueyvatar.com/avatar/$HASH?json=true"
```

Profile card:

```sh
curl "https://img.blueyvatar.com/profile/chris.cdaeris.com"
```

## JavaScript

```js
const BASE = 'https://img.blueyvatar.com'

async function emailHash(email) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const hash = await emailHash('ada@example.com')
const res = await fetch(`${BASE}/avatar/${hash}?json=true`, {
  headers: { 'x-api-key': process.env.BLUEYVATAR_KEY }, // server side only
})
if (!res.ok) {
  const { error } = await res.json()
  throw new Error(`${error.code}: ${error.message}`)
}
console.log(res.headers.get('x-rate-limit-remaining'), await res.json())
```

In a browser, use a website key in the `token` query parameter and never ship a server key.

## Key types and lifetime

| Key | Starts with | Sent in | What it is for |
| --- | --- | --- | --- |
| Website key (read only, safe to put in a web page) | `pk_` | `token` query parameter | Fetching avatars from a web page or app. On paid plans you can limit it to your own domains. |
| Server key (read only, keeps usage and stays private) | `sk_` | `x-api-key` header | Fetching avatars and reading `GET /usage` from your own server. Never put it in a web page. |

Both key types are read only. The API has no write routes yet.

When you create a key you pick its lifetime: Forever, 30 days, 90 days, or 1 year. Forever is the default and the key never expires. Any other choice sets an expiration time, and after it passes the key is rejected with `401 key_expired`. Create a replacement on the API keys page before then. We email the account owner shortly before a key that expires stops working; a Forever key gets no such email.

## HTML

```html
<img
  src="https://img.blueyvatar.com/u/chris.cdaeris.com?s=96"
  width="48"
  height="48"
  alt="Chris"
  loading="lazy"
  referrerpolicy="no-referrer"
>
```

Set `referrerpolicy="no-referrer"` on avatar images, so your page URL is not sent to the avatar host. The one exception is a website key with a domain list: an `<img>` request carries no `Origin` header, so the key check reads `Referer`. For that case use `referrerpolicy="origin"`, which sends only your site origin.
