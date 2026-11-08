import { pdsHost } from './pds'
import { pdsUrl, repoSession } from './repo'

/** The plain term for a PDS (owner decision pending, see PR notes). Change it here to change it everywhere. */
export const HOME_SERVER_TERM = "your Bluesky account's home server"

/** The phrase with the real host name when known: "your Bluesky account's home server (example.host.bsky.network)". */
export function homeServerPhrase(host: string | null): string {
  return host ? `${HOME_SERVER_TERM} (${host})` : HOME_SERVER_TERM
}

/** Host name of the signed-in user's own server, or null if it cannot be resolved. */
export async function homeServerHost(did: string): Promise<string | null> {
  try {
    return pdsHost(await pdsUrl(await repoSession(did)))
  } catch {
    return null
  }
}

export async function homeServerFor(did: string): Promise<string> {
  return homeServerPhrase(await homeServerHost(did))
}
