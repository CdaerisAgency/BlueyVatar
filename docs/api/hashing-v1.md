# Email hashing (v1)

The API never accepts a raw email address, because a URL appears in server logs and in the logs of intermediaries. Compute the hash on the client and send only the hash.

## Algorithm

1. Trim leading and trailing whitespace.
2. Lowercase the string.
3. Hash the UTF-8 bytes with SHA-256.
4. Encode the digest as 64 lowercase hex characters.

This matches `emailHash` in `packages/core/src/hash.ts`.

## Examples

JavaScript (browser or Node 18+):

```js
async function emailHash(email) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

Python:

```python
import hashlib

def email_hash(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
```

Shell (`printf` avoids a trailing newline, which would change the hash; `sed` trims; `tr` lowercases):

```sh
printf '%s' "Ada@Example.com" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]' | sha256sum | cut -d' ' -f1
```

On macOS, use `shasum -a 256` in place of `sha256sum`.

## Using the hash

```
GET /avatar/{hash}
```

A trailing `.png`, `.jpg`, `.jpeg`, or `.webp` on the hash is stripped and the hash is lowercased before validation. Output format is chosen with `fmt`, not with the extension.

## MD5 for legacy clients

`/avatar/{hash}` also accepts a 32-character MD5 hex hash, computed with the same trim and lowercase steps. It exists for older Gravatar and Libravatar clients. Limits:

- MD5 works on `/avatar/{hash}` only. `/profile/{id}` and `/qr/{id}` accept SHA-256 hashes, handles, and DIDs.
- A link answers to MD5 only if its email was verified after migration 0006. Older links answer to SHA-256 until the owner verifies the email again.
- New integrations should use SHA-256.

## Errors

Any value that is not 64 or 32 hex characters on `/avatar/{hash}` returns `400 invalid_identifier`. On `/profile/{id}`, an email address returns `400 invalid_identifier`. See [errors-v1.md](errors-v1.md).
