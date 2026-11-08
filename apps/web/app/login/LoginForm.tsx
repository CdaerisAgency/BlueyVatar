'use client'

import { useActionState, useRef } from 'react'
import { Button } from '../../components/Button'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../components/FormNotices'
import { COPY } from '../../lib/copy'
import type { LoginState } from '../../lib/login-form'
import { loginWithHandle } from './actions'

const ORDER = ['handle'] as const

export function LoginForm({ next, serverError }: { next: string; serverError?: string }) {
  const [state, action] = useActionState(loginWithHandle, {} as LoginState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'login', ORDER, summary)
  const error = state.errors?.handle
  return (
    <form action={action} noValidate>
      {serverError && !state.values && <p role="alert">{serverError}</p>}
      <FormNotices prefix="login" labels={ORDER} state={state} summary={summary} />
      <input type="hidden" name="next" value={next} />
      <label>
        {COPY.login.label}{' '}
        <input
          {...fieldProps('login', 'handle', error, 'login-help')}
          name="handle"
          key={state.values ? 'r' : 'i'}
          defaultValue={state.values?.handle ?? ''}
          placeholder={COPY.login.placeholder}
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
        <FieldError prefix="login" name="handle" error={error} />
      </label>
      <p id="login-help">{COPY.login.help}</p>
      <Button type="submit" variant="primary">
        {COPY.login.submit}
      </Button>
    </form>
  )
}
