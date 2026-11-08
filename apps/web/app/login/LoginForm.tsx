'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { COPY } from '../../lib/copy'
import { loginWithHandle } from './actions'
import { HANDLE_ERROR, normalizeHandle } from './handle'

export function LoginForm({ next, serverError }: { next: string; serverError?: string }) {
  const [clientError, setClientError] = useState<string | null>(null)
  const error = clientError ?? serverError
  const describedBy = ['login-help', error ? 'login-error' : null].filter(Boolean).join(' ')

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem('handle') as HTMLInputElement
    const handle = normalizeHandle(input.value)
    if (!handle) {
      e.preventDefault()
      setClientError(HANDLE_ERROR)
      return
    }
    setClientError(null)
    input.value = handle
  }

  return (
    <>
      {error && <p role="alert" id="login-error">{error}</p>}
      <form action={loginWithHandle} onSubmit={onSubmit} noValidate>
        <input type="hidden" name="next" value={next} />
        <label>
          {COPY.login.label}{' '}
          <input name="handle" aria-invalid={error ? true : undefined} aria-describedby={describedBy} placeholder={COPY.login.placeholder} required autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </label>
        <p id="login-help">{COPY.login.help}</p>
        <Button type="submit" variant="primary">
          {COPY.login.submit}
        </Button>
      </form>
    </>
  )
}
