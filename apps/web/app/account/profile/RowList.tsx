'use client'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Button } from '../../../components/Button'

/** Rows carry a stable key so removing one row does not shuffle what is typed in the others. */
export type Keyed<T> = T & { key: number }
let nextKey = 1
export const withKeys = <T,>(rows: T[]): Keyed<T>[] => rows.map((r) => ({ ...r, key: nextKey++ }))

/** A fieldset of repeatable rows with an add button, a remove button per row, and a cap. `id` is the fieldset id and the prefix of its help and error ids. */
export function RowList<T>({ id, legend, help, error, noun, max, rows, setRows, blank, row }: {
  id: string
  legend: string
  help: ReactNode
  error: string | undefined
  /** Singular, lower case: "language". Builds "Language 2", "Remove language 2" and "Add a language". */
  noun: string
  max: number
  rows: Keyed<T>[]
  setRows: Dispatch<SetStateAction<Keyed<T>[]>>
  blank: T
  row: (r: Keyed<T>, i: number, update: (patch: Partial<T>) => void) => ReactNode
}) {
  const label = noun[0]!.toUpperCase() + noun.slice(1)
  return (
    <fieldset className="bv-setting" id={id} tabIndex={-1}>
      <legend>{legend}</legend>
      <p id={`${id}-help`}>{help}</p>
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      {rows.map((r, i) => (
        <div key={r.key} role="group" aria-label={`${label} ${i + 1}`}>
          {row(r, i, (patch) => setRows(rows.map((x) => (x.key === r.key ? { ...x, ...patch } : x))))}
          <Button type="button" variant="danger" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>Remove {noun} {i + 1}</Button>
        </div>
      ))}
      <Button type="button" disabled={rows.length >= max} onClick={() => setRows([...rows, ...withKeys([blank])])}>Add a {noun}</Button>
    </fieldset>
  )
}
