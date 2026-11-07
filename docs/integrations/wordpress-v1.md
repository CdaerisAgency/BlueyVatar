# WordPress (v1)

The plugin in `integrations/wordpress/` points WordPress avatars at a BlueyVatar delivery host. This page covers install, settings, how it works, the license, and distribution. The plugin is not in the wordpress.org directory.

## Install

1. Zip the `integrations/wordpress` folder as `blueyvatar-avatars` and upload it at Plugins, Add New, Upload Plugin. WordPress documents plugin installation in its [plugin handbook](https://developer.wordpress.org/plugins/).
2. Activate it.
3. Open Settings, Discussion. The BlueyVatar avatars section has three fields.

| Field | Default | Notes |
| --- | --- | --- |
| Delivery base URL | `https://img.blueyvatar.com` | HTTPS only. The default host is not final. Self-hosters enter their own. |
| Default style | `identicon` | Replaces the default chosen in the Avatars list above it. |
| Maximum rating | `g` | `g`, `pg`, `r`, or `x`. |

## How it works

- The plugin filters `get_avatar_url`. WordPress calls this filter for every avatar it renders, including the 2x image in `srcset`.
- It resolves the email from a user ID, an email string, a `WP_User`, a `WP_Post`, or a `WP_Comment`, trims and lowercases it, and hashes it with SHA-256 in PHP. The result is `/avatar/{sha256}?s=...&d=...&r=...`. The raw email never goes into a URL.
- When WordPress passes only a Gravatar hash, there is no email to hash, so the URL stays as WordPress built it.
- It adds `referrerpolicy="no-referrer"` to avatar images through the `pre_get_avatar_data` filter (`extra_attr`).
- The hash and URL builder live in `includes/url.php` with no WordPress calls. `tests/test-url.php` tests it, and a Vitest check compares its output with `@blueyvatar/avatar`. CI also runs `php -l` on every plugin file.

Sources: the [`pre_get_avatar_data` reference](https://developer.wordpress.org/reference/hooks/pre_get_avatar_data/) lists the argument keys (`size`, `default`, `force_default`, `rating`, `extra_attr`). The reference page does not describe `get_avatar_url`; the filter signature `( $url, $id_or_email, $args )` comes from the WordPress core source.

## Limits

- A person sees their image only when they have a BlueyVatar profile with a verified email. Everyone else sees the default style.
- Lowercasing uses `mb_strtolower` when PHP has mbstring, which matches JavaScript for ordinary addresses. Rare special-case letters can differ between the two languages.
- Publishable keys (`token=`) are not supported in this version.

## License

The plugin is licensed Apache-2.0, an owner decision. Checked against the official sources on 2026-11-07:

- The wordpress.org [Detailed Plugin Guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/), guideline 1, says any GPL-compatible license is acceptable and strongly recommends GPLv2 or later. It does not name Apache-2.0.
- The FSF [license list](https://www.gnu.org/licenses/license-list.html) says Apache-2.0 is compatible with version 3 of the GNU GPL and is not compatible with GPL version 2.
- WordPress itself is GPLv2 or later, which includes GPLv3, so Apache-2.0 code can be combined with it under GPLv3. That is the reasoning for acceptance. Whether the Plugin Review Team accepts Apache-2.0 is not confirmed by any page. Before any directory submission, ask plugins@wordpress.org.
- If the directory requires GPLv2 or later, the plugin header and `readme.txt` would change to `GPL-2.0-or-later`. Until the owner decides otherwise, they say `Apache-2.0`.

## Distribution

For now the plugin is distributed as a GitHub release only. Zip the `integrations/wordpress` folder as `blueyvatar-avatars.zip`, attach it to a release, and install it with Plugins, Add New, Upload Plugin. Publishing to the wordpress.org directory is tracked in a separate issue and has not been started. When it is, start from the [plugin submission guide](https://developer.wordpress.org/plugins/wordpress-org/planning-submitting-and-maintaining-plugins/) and settle the license question above first.

Spec reference: section 1 (assumption 4) and section 3 row 8.
