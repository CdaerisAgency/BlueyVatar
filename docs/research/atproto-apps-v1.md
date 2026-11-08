# atproto apps for the integrations page (issue #155)

Checked: November 7, 2026. Scope: which atproto apps BlueyVatar lists on `/integrations` and detects on a signed-in account.

## Owner request

"i'm assuming that we are going to have an 'integrations' or 'linking' page that has all of these platforms. If so, I want to include an impressive list of sites that are atproto sites like tangle.org. this will help build visual credibility, even though the atproto sites are basicly freebies from a development perspective."

"tangle.org" is Tangled, at `tangled.org`. Its home page says "AT Protocol enables federated code collaboration."

## How an app is confirmed

An app is listed only when both checks pass on the date above:

1. **Site live.** The app's own home page answered HTTP 200 and its own text or page metadata describes the app.
2. **NSID live.** The relay `relay1.us-east.bsky.network`, called as `com.atproto.sync.listReposByCollection?collection=<NSID>&limit=3`, returned repos for the NSID. That shows real accounts hold records in the collection today.

For apps whose lexicon file I could read in the project's public repository on `raw.githubusercontent.com`, the file's `id` matched the NSID (WhiteWind, Leaflet, Frontpage, Grain). For the others, only the relay check confirms the NSID.

## Apps listed

| App | URL | Collections matched (NSID prefix) | One line (from the app's own text) | Source |
| --- | --- | --- | --- | --- |
| Bluesky | https://bsky.app | `app.bsky.feed.post` | Social network. Page: "Social media as it should be." | Home page meta description; relay returned repos |
| Tangled | https://tangled.org | `sh.tangled.`, `org.tangled.` | Open, federated code forge. Page: "Tangled is your open, federated code forge for the next decade." | Home page meta description and body; relay returned repos for `sh.tangled.repo`, `sh.tangled.actor.profile`, `org.tangled.actor.profile`. `org.tangled.repo` returned none, so repos still live under `sh.tangled.` |
| WhiteWind | https://whtwnd.com | `com.whtwnd.` | Markdown blogging for anyone with a Bluesky account. | Home page meta description; lexicon `com.whtwnd.blog.entry` read from the project repo; relay returned repos |
| Leaflet | https://leaflet.pub | `pub.leaflet.` | Social publishing for blogs and newsletters. | Home page meta description; lexicon `pub.leaflet.document` read; relay returned repos for `pub.leaflet.document` and `pub.leaflet.publication` |
| pckt | https://pckt.blog | `blog.pckt.` | Distraction-free blogging. Page: "A distraction-free space to write and share your story." | Home page meta description; relay returned repos for `blog.pckt.document`. The home page does not mention atproto, so the NSID check is the evidence |
| Frontpage | https://frontpage.fyi | `fyi.unravel.frontpage.` | Federated link aggregator. Page: "A federated link aggregator." | Home page meta description; lexicon `fyi.unravel.frontpage.post` read; relay returned repos |
| Smoke Signal | https://smokesignal.events | `events.smokesignal.` | Event discovery and RSVPs. Page: "event discovery and browsing application for the ATmosphere." | Home page meta description; relay returned repos for `events.smokesignal.calendar.event`. The same app also writes the shared `community.lexicon.calendar.event`, which is not matched because other apps can write it |
| Linkat | https://linkat.blue | `blue.linkat.` | Link in bio, stored in your PDS. Page: "Your links are saved in your PDS." | Home page meta description; relay returned repos for `blue.linkat.board` |
| Grain | https://grain.social | `social.grain.` | Photo galleries. Page: "photo sharing app built on the AT Protocol." | Home page meta description; lexicon `social.grain.gallery` read; relay returned repos |
| BookHive | https://bookhive.buzz | `buzz.bookhive.` | Book tracking. Page: "Track your books, connect with friends". | Home page meta description; relay returned repos for `buzz.bookhive.book` |
| teal.fm | https://teal.fm | `fm.teal.` | Music listening history. Page: "Your music journey, beautifully tracked." | Home page title and text; relay returned repos for `fm.teal.alpha.feed.play`. The home page does not mention atproto, and the `alpha` namespace suggests the lexicon may still change, so recheck the prefix periodically |
| Semble | https://semble.so | `network.cosmik.` | Collecting and connecting web pages. Page: "A place for mapping the web, connecting ideas, and building shared knowledge." | Home page meta description; relay returned repos for `network.cosmik.card`. Same note on atproto mention as pckt |

## Checked and left out

| App | Reason |
| --- | --- |
| Skylights (`my.skylights.rel`) | The relay returned repos, but `https://skylights.my` answered 404 and `www.skylights.my` failed its TLS check, so I could not confirm the app is live. Add it once the site answers |
| Popfeed (`social.popfeed.feed.listItem`) | Relay returned repos and the site answers 200, but the page is rendered by script and I could not read a description from it |
| Streamplace (`place.stream.livestream`) | Relay returned repos and the site answers 200, but the page text I could read held only the name and a "Try again" prompt, so no description was confirmed |
| Flashes | `flashes.blue` answers 200 and describes itself as "A Photo & Video App for Eurosky & Bluesky". I did not find a collection of its own, so there is nothing to detect. A Flashes post is an `app.bsky` record |
| Community directories | `atproto.com/community/projects` redirects to `docs.bsky.app/showcase`, which redirects to `bsky.network/showcase`. That page returned no readable content to my fetch, so no entry in this memo comes from a directory. Use the NSID check above for any app added later |

Not every app that stores data in a repo is a good fit. An app is listed only when a collection prefix is specific to it. Bluesky is matched on posts only, because `app.bsky.actor.profile` exists for many accounts that never post.

## Detection

- `packages/core/src/atproto-apps.ts` holds the catalog, `detectAtprotoApps(collections)`, and `detectAtprotoAppsForRepo({ pds, did })`, which reads `com.atproto.repo.describeRepo` from the user's PDS. No OAuth. The signed-in DID is already proven, so an app account is the same identity.
- A collection ending in a dot matches by prefix, any other matches exactly.
- A PDS that errors, times out, or returns a bad body gives an empty list and never an error on the page.
- Delivery adds `atprotoApps` to `GET /profile/:handle`, cached for 10 minutes per DID. The web profile page shows app names as plain text.
- Detection says the account holds records in the app's collection. It does not say the account is active there or reveal the username, so the page links to the app's home page and not to a profile on it.

## Logos and brand

Third-party logos are not used. Each app appears by name and text only. I found no press or brand kit permitting use on any of the app pages I opened (Tangled's home page lists a contact address for brand inquiries and no kit). If the owner wants logos later, get each app's written permission or a published kit first. The page notes that listing does not imply endorsement.

## Limits

- The list will go stale. Apps rename namespaces (Tangled moved from `sh.tangled.` toward `org.tangled.`). The catalog is one array, and each entry needs its NSID rechecked against the relay before it is trusted.
- `describeRepo` returns collection names, not record counts, so an account with a single stray record shows as linked.
- The relay check shows that some account has records, not that the app's own site reads them.
- No sitemap exists in the web app, so none was updated.
