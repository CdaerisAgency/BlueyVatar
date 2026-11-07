// Upload limits shared by the browser and the server. No imports, so the client bundle stays small.

/** Upload byte cap: the reference PDS default `blobUploadLimit` (5 * 1024 * 1024, atproto packages/pds/src/config/config.ts). */
export const MAX_BLOB_BYTES = 5 * 1024 * 1024
export const MAX_BLOB_MESSAGE = `The image is larger than 5 MB (${MAX_BLOB_BYTES.toLocaleString('en-US')} bytes). Choose a smaller file.`
/** Longest edge kept. Larger uploads are downscaled to this, in the browser first and on the server as a fallback. */
export const MAX_LONG_EDGE = 4096
