# Ghost (v1)

Ghost has no setting for the avatar host and no Handlebars helper that hashes an email address, so there are two supported patterns. Neither needs a plugin.

## Authors and fixed people

Ghost stores a staff profile image as an uploaded file, and themes print it with `{{profile_image}}` inside `{{#primary_author}}` or `{{#foreach authors}}` ([authors helper](https://docs.ghost.org/themes/helpers/data/authors.md)). To use BlueyVatar for a person, hash their email once ([hashing-v1.md](../api/hashing-v1.md)) and write the image in the theme, in a partial such as `partials/author-avatar.hbs`:

```hbs
<img
  src="https://img.blueyvatar.com/avatar/HASH?s=96&d=identicon&r=g"
  width="96" height="96" alt="{{name}}"
  referrerpolicy="no-referrer" loading="lazy">
```

Keep the hash in the theme, not the email address.

## Members

Themes read a member's details from `@member`, including `@member.email` ([members in themes](https://docs.ghost.org/themes/members.md)). The avatar is the `avatar_image` of a subscription, which Ghost describes as pulled in from Gravatar. Handlebars cannot hash an address, so rewrite that image after the page loads.

In Ghost Admin, open Settings, Code Injection, and paste this into Site Footer. Site Footer code is placed before the closing body tag on every page ([Ghost code injection tutorial](https://ghost.org/tutorials/use-code-injection-in-ghost/), [`ghost_foot`](https://docs.ghost.org/themes/helpers/utility/ghost_head_foot.md)).

```html
<script>
(function () {
  var BASE = 'https://img.blueyvatar.com'
  document.querySelectorAll('img[src*="gravatar.com/avatar/"]').forEach(function (img) {
    var m = /\/avatar\/([0-9a-f]{32}|[0-9a-f]{64})/i.exec(img.src)
    if (!m) return
    var size = new URL(img.src).searchParams.get('s') || '96'
    img.referrerPolicy = 'no-referrer'
    img.src = BASE + '/avatar/' + m[1].toLowerCase() + '?s=' + encodeURIComponent(size) + '&d=identicon&r=g'
  })
})()
</script>
```

Limits of this pattern:

- The browser may request the Gravatar image before the script runs. It reduces Gravatar traffic but cannot stop the first request. If that matters, remove the Gravatar image in the theme instead.
- Gravatar URLs carry an MD5 or SHA-256 hash. BlueyVatar answers to a SHA-256 hash always, and to MD5 only for emails verified after migration 0006 ([hashing-v1.md](../api/hashing-v1.md#md5-for-legacy-clients)).
- The script was written from the Ghost documentation and has not been run on a live Ghost site. Test it on a staging site first.

Spec reference: section 9 (embed guidance).
