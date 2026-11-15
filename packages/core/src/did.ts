/** DID check shared by the web app. Import by subpath: `@blueyvatar/core/did`. */

/** A did:plc or did:web with a body of 1 to 200 characters from the set the web forms accept. */
export const DID_RE = /^did:(plc|web):[A-Za-z0-9._:%-]{1,200}$/

export function isDid(value: unknown): value is string {
  return typeof value === 'string' && DID_RE.test(value)
}
