// Client-safe: no imports except types from form-state, so the import form can bundle it.
import type { FormState } from './form-state'

export type ImportField = 'alt' | 'rating' | 'rLabel'
export type ImportValues = { alt: string; rating: string; rLabel: string; isDefault: boolean }
export type ImportState = FormState<ImportValues, ImportField>
export const IMPORT_FIELDS: readonly ImportField[] = ['alt', 'rating', 'rLabel']
