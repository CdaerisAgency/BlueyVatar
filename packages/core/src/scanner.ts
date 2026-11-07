/**
 * Upload-time content screening (issue #207).
 *
 * A ContentScanner checks image bytes against a hash-matching service before the blob is written to
 * the user's PDS. Implementations must never log or persist the bytes.
 */
export type ScanResult =
  /** No match, or the scanner is off. */
  | { status: 'clear' }
  /** The service flagged the image. `service` names the vendor, `flags` carries vendor match flags (no image data). */
  | { status: 'match'; service: string; flags: string[] }
  /** The service could not give an answer (network error, bad status, bad body). */
  | { status: 'error'; service: string; reason: string }

export interface ContentScanner {
  readonly name: string
  scan(bytes: Uint8Array, mime: string): Promise<ScanResult>
}

/** Scanner used when no service is configured. Always clear. */
export class NoopScanner implements ContentScanner {
  readonly name = 'none'
  async scan(): Promise<ScanResult> {
    return { status: 'clear' }
  }
}

export interface PhotoDnaOptions {
  /** Full URL of the Match operation from the PhotoDNA API Management Portal. */
  endpoint: string
  /** Subscription key issued at onboarding. Sent as the Ocp-Apim-Subscription-Key header. */
  key: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * Microsoft PhotoDNA Cloud Service client.
 *
 * Confirmed from Microsoft's pages:
 *  - https://www.microsoft.com/en-us/photodna/cloudservice : a "simple REST API call"; images are hashed and not retained.
 *  - https://www.microsoft.com/en-us/PhotoDNA/Documentation : the Match operation validates an image (or URL) against a
 *    hash set, and each subscriber calls the REST API with a subscription key.
 *
 * UNVERIFIED (the request and response schemas sit behind the onboarding portal,
 * https://developer.microsoftmoderator.com/apis, which could not be read before approval): the header name
 * Ocp-Apim-Subscription-Key, the JSON request body {DataRepresentation: 'inline', Value: <base64>}, and the response fields
 * Status.Code (3000 means OK), IsMatch, and MatchDetails.MatchFlags. They follow the Azure API Management convention and
 * public sample code. Compare with the portal schema once access is granted, and adjust here only.
 * The endpoint is read from the environment, so the exact URL is never hardcoded.
 */
export class PhotoDnaScanner implements ContentScanner {
  readonly name = 'photodna'
  constructor(private readonly opts: PhotoDnaOptions) {}

  async scan(bytes: Uint8Array, mime: string): Promise<ScanResult> {
    const fail = (reason: string): ScanResult => ({ status: 'error', service: this.name, reason })
    const f = this.opts.fetch ?? fetch
    try {
      const res = await f(this.opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': this.opts.key },
        body: JSON.stringify({ DataRepresentation: 'inline', Value: Buffer.from(bytes).toString('base64'), ContentType: mime }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
      })
      if (!res.ok) return fail(`http ${res.status}`)
      const body = (await res.json()) as { IsMatch?: unknown; Status?: { Code?: unknown }; MatchDetails?: { MatchFlags?: unknown } }
      if (typeof body.IsMatch !== 'boolean') return fail('unexpected response')
      if (body.Status?.Code !== undefined && body.Status.Code !== 3000) return fail(`status ${String(body.Status.Code)}`)
      if (!body.IsMatch) return { status: 'clear' }
      const raw = body.MatchDetails?.MatchFlags
      const flags = Array.isArray(raw) ? raw.map((x) => (typeof x === 'object' && x ? JSON.stringify(x) : String(x))).slice(0, 20) : []
      return { status: 'match', service: this.name, flags }
    } catch (err) {
      // Only the error class: a message could echo request details.
      return fail(err instanceof Error ? err.name : 'unknown')
    }
  }
}

export interface ScannerEnv { PHOTODNA_ENDPOINT?: string; PHOTODNA_KEY?: string; [k: string]: string | undefined }

/** PhotoDNA when both PHOTODNA_ENDPOINT and PHOTODNA_KEY are set, otherwise the no-op scanner. */
export function scannerFromEnv(env: ScannerEnv = process.env, fetchImpl?: typeof fetch): ContentScanner {
  const endpoint = env.PHOTODNA_ENDPOINT?.trim()
  const key = env.PHOTODNA_KEY?.trim()
  if (!endpoint || !key) return new NoopScanner()
  return new PhotoDnaScanner({ endpoint, key, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
}

export type ScanDecision =
  | { allow: true; outcome: 'clear' | 'outage_allowed' }
  | { allow: false; outcome: 'match' | 'outage_blocked'; service: string; flags: string[] }

/**
 * Default policy: a match always blocks; an outage allows the upload (and the caller logs a warning).
 * SCAN_FAIL_CLOSED=1 (or true) blocks on outage as well.
 */
export function decideScan(result: ScanResult, env: { SCAN_FAIL_CLOSED?: string | undefined } = process.env): ScanDecision {
  if (result.status === 'clear') return { allow: true, outcome: 'clear' }
  if (result.status === 'match') return { allow: false, outcome: 'match', service: result.service, flags: result.flags }
  const closed = /^(1|true)$/i.test(env.SCAN_FAIL_CLOSED ?? '')
  return closed ? { allow: false, outcome: 'outage_blocked', service: result.service, flags: [] } : { allow: true, outcome: 'outage_allowed' }
}

export const SCAN_REJECT_MESSAGE = "This image was flagged by an automated screening service and can't be uploaded."
export const SCAN_OUTAGE_MESSAGE = 'Image screening is unavailable right now. Try again in a few minutes.'
