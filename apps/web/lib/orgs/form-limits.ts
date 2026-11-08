// Client-safe: no imports except types from form-state.
import type { FormState } from '../form-state'

export type CreateOrgField = 'name'
export type CreateOrgState = FormState<{ name: string }, CreateOrgField>
export const CREATE_ORG_FIELDS: readonly CreateOrgField[] = ['name']

export type AddMemberField = 'member' | 'role'
export type AddMemberState = FormState<{ member: string; role: string }, AddMemberField>
export const ADD_MEMBER_FIELDS: readonly AddMemberField[] = ['member', 'role']
