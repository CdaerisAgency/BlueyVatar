import { defineConfig } from 'vitest/config'

// DB-backed suites create a schema and run migrations in beforeAll. On a loaded CI runner that
// can take longer than vitest's 10 s default, so give hooks a minute.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000 },
})
