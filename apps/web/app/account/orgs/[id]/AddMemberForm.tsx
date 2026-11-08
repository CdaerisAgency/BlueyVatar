'use client'

import { useActionState, useRef } from 'react'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../../../components/FormNotices'
import { ADD_MEMBER_FIELDS, type AddMemberState } from '../../../../lib/orgs/form-limits'
import { addOrgMember } from '../actions'

export function AddMemberForm({ orgId }: { orgId: string }) {
  const [state, action] = useActionState(addOrgMember, {} as AddMemberState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'member', ADD_MEMBER_FIELDS, summary)
  const e = state.errors ?? {}
  const key = state.values ? 'r' : state.done ? 'd' : 'i'
  return (
    <form action={action} noValidate>
      <FormNotices prefix="member" labels={ADD_MEMBER_FIELDS} state={state} summary={summary} />
      <input type="hidden" name="org" value={orgId} />
      <label>
        DID <input {...fieldProps('member', 'member', e.member)} name="member" key={`m-${key}`} defaultValue={state.values?.member ?? ''} required placeholder="did:plc:..." size={40} />
        <FieldError prefix="member" name="member" error={e.member} />
      </label>{' '}
      <label>
        Role{' '}
        <select {...fieldProps('member', 'role', e.role)} name="role" key={`r-${key}`} defaultValue={state.values?.role ?? 'member'}>
          <option value="member">member</option>
          <option value="owner">owner</option>
        </select>
        <FieldError prefix="member" name="role" error={e.role} />
      </label>{' '}
      <button type="submit">Add member</button>
    </form>
  )
}
