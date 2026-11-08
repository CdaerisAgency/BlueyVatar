import { pdsHost } from './pds'
import { pdsUrl, repoSession } from './repo'

/** The plain term for a PDS. It names no brand, because the account can be hosted anywhere on atproto (issue #246). */
export const HOME_SERVER_TERM = "your account's home server"

/** The phrase with the real host name when known: "your account's home server (example.host.example)". */
export function homeServerPhrase(host: string | null): string {
  return host ? `${HOME_SERVER_TERM} (${host})` : HOME_SERVER_TERM
}

/** The server name for button text: the real host, or a plain stand-in when it cannot be resolved. */
export const serverLabel = (host: string | null): string => host ?? 'my home server'

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
