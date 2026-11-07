import { notFound } from 'next/navigation'
import { DocsView } from '../../../components/DocsView'
import { docPage, docPages } from '../../../lib/docs'

export const dynamicParams = false

export function generateStaticParams() {
  return docPages().filter((p) => p.slug !== '').map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = docPage((await params).slug)
  return page ? { title: `${page.title} | ${page.group === 'api' ? 'API docs' : 'Integration guides'}` } : {}
}

export default async function DocsPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = docPage((await params).slug)
  if (!page || page.slug === '') notFound()
  return <DocsView page={page} />
}
