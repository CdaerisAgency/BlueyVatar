import { redirect } from 'next/navigation'

/** The data page moved into Settings, under the danger zone. */
export default function DataPage(): never {
  redirect('/account/settings/danger')
}
