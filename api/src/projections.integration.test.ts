import { describe, it, expect, afterAll, beforeEach } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection } from './projections.js'
import type { VidgenEvent } from './events.js'

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

describe.skipIf(!up)('applyProjection (integration)', () => {
  afterAll(async () => {
    await db.end()
  })

  beforeEach(async () => {
    await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
  })

  it('ProjectCreated inserts a draft project row', async () => {
    const event: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    await applyProjection(db, event)
    const result = await db.query('SELECT project_id, idea, status FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows).toEqual([{ project_id: 'p1', idea: 'x', status: 'draft' }])
  })

  it('ScriptGenerated sets status to scripted and inserts scene rows', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 2, tone: 'casual' })
    await applyProjection(db, {
      v: 1,
      type: 'ScriptGenerated',
      projectId: 'p1',
      at: '2026-07-09T00:00:01Z',
      scenes: [{ idx: 0, narration: 'a', visual: 'b' }, { idx: 1, narration: 'c', visual: 'd' }],
      scriptUsd: 0,
    })
    const project = await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])
    expect(project.rows[0]).toEqual({ status: 'scripted' })
    const scenes = await db.query('SELECT idx, narration, visual FROM scenes WHERE project_id = $1 ORDER BY idx', ['p1'])
    expect(scenes.rows).toEqual([
      { idx: 0, narration: 'a', visual: 'b' },
      { idx: 1, narration: 'c', visual: 'd' },
    ])
  })

  it('re-applying the same events is idempotent (upsert, not duplicate rows)', async () => {
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    await applyProjection(db, created)
    await applyProjection(db, created)
    const result = await db.query('SELECT count(*)::int AS n FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows[0]).toEqual({ n: 1 })
  })
})
