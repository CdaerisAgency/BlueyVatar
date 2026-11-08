'use client'

import { useActionState, useRef } from 'react'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../../components/FormNotices'
import { CREATE_ORG_FIELDS, type CreateOrgState } from '../../../lib/orgs/form-limits'
import { createOrg } from './actions'

export function CreateOrgForm() {
  const [state, action] = useActionState(createOrg, {} as CreateOrgState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'org', CREATE_ORG_FIELDS, summary)
  const error = state.errors?.name
  return (
    <form action={action} noValidate>
      <FormNotices prefix="org" labels={CREATE_ORG_FIELDS} state={state} summary={summary} />
      <label>
        Name <input {...fieldProps('org', 'name', error)} name="name" key={state.values ? 'r' : 'i'} defaultValue={state.values?.name ?? ''} required maxLength={80} />
        <FieldError prefix="org" name="name" error={error} />
      </label>{' '}
      <button type="submit">Create organization</button>
    </form>
  )
}
