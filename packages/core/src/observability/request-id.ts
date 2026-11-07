import { randomUUID } from 'node:crypto'

export const REQUEST_ID_HEADER = 'x-request-id'
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/

/** Keeps a well-formed incoming id (so a trace can span Cloudflare, web, and delivery), else makes a new one. */
export function requestIdFrom(incoming: string | null | undefined): string {
  return incoming && SAFE_ID.test(incoming) ? incoming : randomUUID()
}
