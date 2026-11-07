=== BlueyVatar Avatars ===
Contributors: cdaerisagency
Tags: avatar, gravatar, privacy, avatars, comments
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Serve WordPress avatars from a BlueyVatar delivery host instead of Gravatar.

== Description ==

BlueyVatar Avatars changes the avatar URL that WordPress builds so it points at a BlueyVatar delivery host. Each email address is lowercased, trimmed, and hashed with SHA-256 on your server. The address itself never appears in a URL, a log line, or a page.

* Works with comments, author boxes, and anywhere WordPress calls `get_avatar_url`.
* Settings under Settings, Discussion: delivery base URL, default style, and maximum rating.
* Adds `referrerpolicy="no-referrer"` to avatar images.
* Leaves a URL alone when WordPress gives the plugin only a Gravatar hash, because a SHA-256 hash cannot be made from a hash.

The default delivery host is https://img.blueyvatar.com. That host is not final. Change it in the settings if you self-host.

This plugin is not affiliated with Gravatar or Automattic.

== Installation ==

1. Upload the `blueyvatar-avatars` folder to `/wp-content/plugins/`.
2. Activate the plugin on the Plugins screen.
3. Open Settings, Discussion, and review the BlueyVatar avatars section.

== Frequently Asked Questions ==

= Does an email address leave my server? =

No. Only the SHA-256 hash is sent, as part of the image URL.

= Why do some people see the default image? =

A person needs a BlueyVatar profile with a verified email to have an avatar. Everyone else gets the default style.

= Which license applies? =

Apache-2.0. See the LICENSE file.

== Changelog ==

= 0.1.0 =
* First release.
