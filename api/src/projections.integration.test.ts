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

  it('MaterialResolved sets status to material and records a material asset', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' })
    const project = await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])
    expect(project.rows[0]).toEqual({ status: 'material' })
    const asset = await db.query('SELECT kind, path FROM assets WHERE project_id = $1', ['p1'])
    expect(asset.rows).toEqual([{ kind: 'material', path: '/m/0.mp4' }])
  })

  it('VoiceSynthesized records a voice asset, a ledger row, and recomputes spent_usd', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, mp3Path: '/m/0.mp3', ttsUsd: 0.0007 })
    const project = await db.query('SELECT spent_usd FROM projects WHERE project_id = $1', ['p1'])
    expect(Number(project.rows[0].spent_usd)).toBeCloseTo(0.0007)
    const ledger = await db.query('SELECT event_type, amount_usd FROM cost_ledger WHERE project_id = $1', ['p1'])
    expect(ledger.rows).toEqual([{ event_type: 'VoiceSynthesized', amount_usd: '0.0007' }])
  })

  it('CaptionsBuilt records an ass_path on the scene and a caption asset', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, assPath: '/m/0.ass' })
    const scene = await db.query('SELECT ass_path FROM scenes WHERE project_id = $1 AND idx = 0', ['p1'])
    expect(scene.rows[0]).toEqual({ ass_path: '/m/0.ass' })
  })

  it('CostProjected does not error and does not add to the ledger (observability only)', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'CostProjected', projectId: 'p1', at: '2026-07-09T00:00:01Z', projectedUsd: 0.01, capUsd: 0.15 })
    const ledger = await db.query('SELECT count(*)::int AS n FROM cost_ledger WHERE project_id = $1', ['p1'])
    expect(ledger.rows[0]).toEqual({ n: 0 })
  })
})
