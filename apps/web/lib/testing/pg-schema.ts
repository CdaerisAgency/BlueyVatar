import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll } from 'vitest'

/** The database the DB tests run against. Tests wrap their suite in `describe.skipIf(!testDbUrl)`. */
export const testDbUrl = process.env.TEST_DATABASE_URL

const migrationsDir = new URL('../../../../db/migrations/', import.meta.url)
const migrationSql = (file: string) => readFileSync(new URL(file.endsWith('.sql') ? file : `${file}.sql`, migrationsDir), 'utf8')

export type SchemaOptions = {
  /** Migration files to apply in order (with or without `.sql`), or `'all'` for every file in db/migrations. */
  migrations: string[] | 'all'
  /** Runs after the migrations, for seed rows or columns the subset does not create. */
  setup?: (pool: pg.Pool) => Promise<void>
}

/** Creates a throwaway schema, a pool whose search_path is that schema, and applies the migrations. */
export async function createSchemaPool(name: string, opts: SchemaOptions): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const schema = `t_${name}_${process.pid}_${Date.now()}`
  const admin = new pg.Client({ connectionString: testDbUrl })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  await admin.end()
  const pool = new pg.Pool({ connectionString: testDbUrl, options: `-c search_path=${schema}` })
  const files = opts.migrations === 'all' ? readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort() : opts.migrations
  for (const f of files) await pool.query(migrationSql(f))
  await opts.setup?.(pool)
  return {
    pool,
    drop: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`)
      await pool.end()
    },
  }
}

/**
 * Call inside a `describe` block. Creates the schema in `beforeAll` and drops it in `afterAll`.
 * The returned pool is a stand-in that forwards to the real pool once `beforeAll` has run.
 */
export function useSchema(name: string, opts: SchemaOptions): pg.Pool {
  let made: Awaited<ReturnType<typeof createSchemaPool>> | undefined
  beforeAll(async () => {
    made = await createSchemaPool(name, opts)
  })
  afterAll(async () => {
    await made?.drop()
  })
  return new Proxy({} as pg.Pool, {
    get(_t, prop) {
      if (!made) throw new Error('useSchema: the pool is only available inside tests and hooks')
      const v = Reflect.get(made.pool, prop) as unknown
      return typeof v === 'function' ? v.bind(made.pool) : v
    },
  })
}
