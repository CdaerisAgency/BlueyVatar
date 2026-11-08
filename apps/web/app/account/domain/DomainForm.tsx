'use client'

import { useActionState, useRef } from 'react'
import { Button } from '../../../components/Button'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../../components/FormNotices'
import { DOMAIN_FIELDS, type DomainState } from '../../../lib/domain-limits'
import { addDomain } from './actions'

export function DomainForm() {
  const [state, action] = useActionState(addDomain, {} as DomainState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'domain', DOMAIN_FIELDS, summary)
  const error = state.errors?.hostname
  return (
    <form action={action} noValidate>
      <FormNotices prefix="domain" labels={DOMAIN_FIELDS} state={state} summary={summary} />
      <label>
        Subdomain you own{' '}
        <input {...fieldProps('domain', 'hostname', error)} name="hostname" key={state.values ? 'r' : 'i'} defaultValue={state.values?.hostname ?? ''} placeholder="me.example.com" required autoComplete="off" spellCheck={false} />
        <FieldError prefix="domain" name="hostname" error={error} />
      </label>
      <Button type="submit" variant="primary">Add domain</Button>
    </form>
  )
}
