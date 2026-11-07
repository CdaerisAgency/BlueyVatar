import { changelogFeed, parseChangelog, readChangelogFile } from '../../../lib/changelog'
import { siteUrl } from '../../../lib/site'

// Built from CHANGELOG.md when the app is built.
export const dynamic = 'force-static'

export function GET() {
  const xml = changelogFeed(parseChangelog(readChangelogFile()), siteUrl())
  return new Response(xml, { headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
}
