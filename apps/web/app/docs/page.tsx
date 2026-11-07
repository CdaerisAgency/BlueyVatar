import { DocsView } from '../../components/DocsView'
import { docPage } from '../../lib/docs'

export const metadata = { title: 'API docs', description: 'The blueyvatar delivery API: parameters, errors, rate limits, and examples.' }

export default function DocsIndex() {
  return <DocsView page={docPage('')!} />
}
