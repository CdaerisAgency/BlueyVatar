import { DocsView } from '../../components/DocsView'
import { docPage } from '../../lib/docs'

export const metadata = { title: 'API docs', description: 'The BlueyVatar delivery API: parameters, errors, rate limits, and examples.' }

export default function DocsIndex() {
  return <DocsView page={docPage('')!} />
}
