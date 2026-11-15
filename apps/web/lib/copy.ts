// New page copy goes in its area file under ./copy/ (public.ts or account.ts), not here.
/**
 * All marketing copy lives under ./copy/ so it can be swapped in one edit.
 * PLACEHOLDER: this is the approved mockup's copy, to be replaced by Start with Why copy (Why, How, What).
 * Prices are not here. They come from ./pricing.ts.
 */
import { ACCOUNT_COPY } from './copy/account'
import { PUBLIC_COPY } from './copy/public'

export const COPY = { ...PUBLIC_COPY, ...ACCOUNT_COPY } as const
