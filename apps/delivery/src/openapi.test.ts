import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from './app.js'
import { ERROR_CODES } from './errors.js'
import { openApiDocument } from './openapi.js'

/** Hono `:name` becomes `{name}` and a trailing wildcard becomes `{path}`. */
const toOpenApiPath = (p: string) => p.replace(/:(\w+)/g, '{$1}').replace(/\/\*$/, '/{path}')

const registered = (): Set<string> => {
  // Handlers are never called here, so the dependencies can stay empty.
  const app = createApp({} as AppDeps)
  // ALL entries are middleware (use), not routes.
  return new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method.toLowerCase()} ${toOpenApiPath(r.path)}`))
}

const documented = (): Set<string> => {
  const out = new Set<string>()
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(item)) out.add(`${method} ${path}`)
  }
  return out
}

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 and serves at /openapi.json', async () => {
    expect(openApiDocument.openapi).toBe('3.1.0')
    const res = await createApp({} as AppDeps).request('/openapi.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(openApiDocument)))
  })

  it('documents every route registered in app.ts, and nothing else', () => {
    const reg = registered()
    expect(reg.size).toBeGreaterThan(5)
    const doc = documented()
    expect([...reg].filter((r) => !doc.has(r))).toEqual([])
    expect([...doc].filter((r) => !reg.has(r))).toEqual([])
  })

  it('documents the avatar query parameters, auth, and rate-limit headers', () => {
    const refs = (op: { parameters: readonly { $ref?: string; name?: string }[] }) => op.parameters.map((p) => p.$ref?.split('/').pop() ?? p.name)
    for (const op of [openApiDocument.paths['/avatar/{hash}'].get, openApiDocument.paths['/u/{id}'].get]) {
      for (const name of ['s', 'd', 'f', 'r', 'fmt', 'q', 'ttl', 'json']) expect(refs(op)).toContain(name)
    }
    expect(Object.keys(openApiDocument.components.securitySchemes)).toEqual(['apiKeyHeader', 'apiKeyQuery'])
    expect(openApiDocument.components.securitySchemes.apiKeyHeader.name).toBe('x-api-key')
    expect(Object.keys(openApiDocument.components.headers)).toEqual(expect.arrayContaining(['RateLimitLimit', 'RateLimitRemaining', 'RateLimitReset', 'RetryAfter']))
  })

  it('lists exactly the error codes in errors.ts', () => {
    const doc = openApiDocument.components.schemas.Error.properties.error.properties.code.enum
    expect([...doc].sort()).toEqual([...ERROR_CODES].sort())
  })

  it('keeps docs/api/errors-v1.md in step with errors.ts', () => {
    const md = readFileSync(new URL('../../../docs/api/errors-v1.md', import.meta.url), 'utf8')
    const table = md.split('## Error codes')[1]!.split('\n## ')[0]!
    const codes = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]!)
    expect([...codes].sort()).toEqual([...ERROR_CODES].sort())
  })

  it('names every code the routes can return in a response description', () => {
    const text = JSON.stringify(openApiDocument.paths)
    const missing = ERROR_CODES.filter((c) => !text.includes(c))
    expect(missing).toEqual([])
  })
})
