import { describe, it, expect, afterAll } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

// Probe Postgres reachability once at module load so the suite can be
// skipped cleanly with zero services running (no local Postgres at DATABASE_URL).
const db: Database = createPool(DATABASE_URL)
let up = true
try {
  await db.query('SELECT 1')
} catch {
  up = false
}

describe.skipIf(!up)('migrate', () => {
  afterAll(async () => {
    await db.end()
  })

  it('creates projects, scenes, assets, cost_ledger tables', async () => {
    await migrate(db)
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )
    const tables = result.rows.map((r) => r.table_name)
    expect(tables).toEqual(expect.arrayContaining(['projects', 'scenes', 'assets', 'cost_ledger']))
  })

  it('is idempotent — running migrate twice does not error', async () => {
    await migrate(db)
    await expect(migrate(db)).resolves.toBeUndefined()
  })
})
