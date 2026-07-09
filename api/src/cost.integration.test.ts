import { describe, it, expect, afterAll } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { readLedger } from './cost.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

// Probe Postgres reachability once at module load so the suite can be
// skipped cleanly with zero services running (no local Postgres at DATABASE_URL).
const db: Database = createPool(DATABASE_URL)
let up = true
try {
  await db.query('SELECT 1')
  await migrate(db)
} catch {
  up = false
}

describe.skipIf(!up)('readLedger (integration)', () => {
  afterAll(async () => {
    await db.end()
  })

  it('reads ledger rows for a project in chronological order', async () => {
    const projectId = `p-${Date.now()}`
    await db.query(
      `INSERT INTO projects (project_id, idea, duration_sec, scene_count, tone) VALUES ($1, 'x', 30, 1, 'casual')`,
      [projectId],
    )
    await db.query(
      `INSERT INTO cost_ledger (project_id, event_type, scene_idx, amount_usd, at) VALUES
        ($1, 'VoiceSynthesized', 0, 0.0007, '2026-07-09T00:01:00Z'),
        ($1, 'RenderCompleted', NULL, 0, '2026-07-09T00:02:00Z')`,
      [projectId],
    )
    const entries = await readLedger(db, projectId)
    expect(entries).toEqual([
      { eventType: 'VoiceSynthesized', sceneIdx: 0, amountUsd: 0.0007, at: '2026-07-09T00:01:00.000Z' },
      { eventType: 'RenderCompleted', sceneIdx: null, amountUsd: 0, at: '2026-07-09T00:02:00.000Z' },
    ])
  })
})
