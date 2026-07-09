import { describe, it, expect, afterAll } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection } from './projections.js'
import { listProjects, getProject } from './http.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

// Probe Postgres reachability once at module load so the suite can be
// skipped cleanly with zero services running (no local Postgres at DATABASE_URL).
const db: Database = createPool(DATABASE_URL)
let up = true
try {
  await db.query('SELECT 1')
  await migrate(db)
  await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
} catch {
  up = false
}

describe.skipIf(!up)('listProjects + getProject (integration)', () => {
  afterAll(async () => {
    await db.end()
  })

  it('lists created projects and fetches one by id with its scenes', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })

    const all = await listProjects(db)
    expect(all).toEqual([{ projectId: 'p1', idea: 'x', status: 'scripted', spentUsd: 0, approved: false, outputPath: null }])

    const one = await getProject(db, 'p1')
    expect(one?.scenes).toEqual([{ idx: 0, narration: 'a', visual: 'b', materialPath: null, mp3Path: null, assPath: null }])

    expect(await getProject(db, 'missing')).toBeNull()
  })
})
