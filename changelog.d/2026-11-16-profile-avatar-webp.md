### Changed
- Public profile pages load the avatar as a WebP image in a size chosen for the screen, and load it first, so the page paints faster on phones.
- The profile JSON `avatar` object has a new `variants` list with signed WebP (256 and 512) and PNG (512) image paths. `avatar.url` is unchanged.
