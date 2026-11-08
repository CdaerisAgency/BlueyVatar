'use client'

import { useActionState, useRef } from 'react'
import { Button } from '../../../../components/Button'
import { FieldError, FormNotices, fieldProps, useFocusResult } from '../../../../components/FormNotices'
import { IMPORT_FIELDS, type ImportState } from '../../../../lib/import-limits'
import RatingFields from '../RatingFields'
import { confirmImport } from './actions'

export function ImportForm({ source, previewUri, label, suggested }: { source: string; previewUri: string; label: string; suggested: string | null }) {
  const [state, action] = useActionState(confirmImport, {} as ImportState)
  const summary = useRef<HTMLDivElement>(null)
  useFocusResult(state, 'import', IMPORT_FIELDS, summary)
  const v = state.values
  const e = state.errors ?? {}
  return (
    <form action={action} noValidate>
      <FormNotices prefix="import" labels={IMPORT_FIELDS} state={state} summary={summary} />
      <input type="hidden" name="source" value={source} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={previewUri} alt="Preview of the image to import" width={160} height={160} className="object-cover" />
      <p>
        This image comes from {label}. Confirm its rating before it is saved to your repository, where it will be public.
        {suggested === null ? ' We cannot see how the image was rated, so choose a rating.' : ''}
      </p>
      <RatingFields
        idPrefix="import"
        defaultRating={v?.rating ?? suggested ?? ''}
        defaultRLabel={v?.rLabel || 'sexual'}
        needsChoice={suggested === null}
        ratingError={e.rating}
        rLabelError={e.rLabel}
      />
      <label>
        Alt text (up to 300 characters){' '}
        <textarea {...fieldProps('import', 'alt', e.alt)} name="alt" key={v ? 'r' : 'i'} defaultValue={v?.alt ?? ''} maxLength={3000} rows={2} />
        <FieldError prefix="import" name="alt" error={e.alt} />
      </label>
      <label>
        <input name="isDefault" type="checkbox" key={v ? 'r' : 'i'} defaultChecked={v?.isDefault ?? false} /> Use as my default image
      </label>
      <Button type="submit" variant="primary">Import</Button>
    </form>
  )
}
