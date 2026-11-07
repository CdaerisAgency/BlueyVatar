import { DOC_PAGES, type DocPage } from './docs.generated'

export type { DocPage }
export const docPages = (): DocPage[] => DOC_PAGES
export const docPage = (slug: string): DocPage | undefined => DOC_PAGES.find((p) => p.slug === slug)
export const docHref = (slug: string): string => (slug === '' ? '/docs' : `/docs/${slug}`)
