// Client-safe: no imports except types from form-state.
import type { FormState } from './form-state'

export type DomainField = 'hostname'
export type DomainValues = { hostname: string }
export type DomainState = FormState<DomainValues, DomainField>
export const DOMAIN_FIELDS: readonly DomainField[] = ['hostname']
