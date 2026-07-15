import { describe, it, expect, afterAll, beforeEach } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection, rebuildProjections } from './projections.js'
import { connectBus, ensureStreams, publishEvent, EVENTS_STREAM } from './nats.js'
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

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4223'

// Probe NATS reachability once at module load too (needs both local
// Postgres and local NATS), alongside the file's existing `up` probe.
let natsUp = true
try {
  const probeBus = await connectBus(NATS_URL)
  await probeBus.nc.drain()
} catch {
  natsUp = false
}

// Close the shared pool once after ALL suites in this file (not inside the
// first describe — its afterAll would end the pool before the rebuild suite
// below, which reuses the same module-level `db`, ever runs).
afterAll(async () => {
  await db.end()
})

describe.skipIf(!up)('applyProjection (integration)', () => {
  beforeEach(async () => {
    await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
  })

  it('ProjectCreated inserts a draft project row', async () => {
    const event: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' }
    await applyProjection(db, event)
    const result = await db.query('SELECT project_id, idea, status FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows).toEqual([{ project_id: 'p1', idea: 'x', status: 'draft' }])
  })

  it('ScriptGenerated sets status to scripted and inserts scene rows', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 2, tone: 'casual', language: 'English' })
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
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' }
    await applyProjection(db, created)
    await applyProjection(db, created)
    const result = await db.query('SELECT count(*)::int AS n FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows[0]).toEqual({ n: 1 })
  })

  it('MaterialResolved sets status to material and records a material asset', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' })
    const project = await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])
    expect(project.rows[0]).toEqual({ status: 'material' })
    const asset = await db.query('SELECT kind, path FROM assets WHERE project_id = $1', ['p1'])
    expect(asset.rows).toEqual([{ kind: 'material', path: '/m/0.mp4' }])
  })

  it('VoiceSynthesized records a voice asset, a ledger row, and recomputes spent_usd', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, mp3Path: '/m/0.mp3', durationSec: 3.5, ttsUsd: 0.0007 })
    const project = await db.query('SELECT spent_usd FROM projects WHERE project_id = $1', ['p1'])
    expect(Number(project.rows[0].spent_usd)).toBeCloseTo(0.0007)
    const ledger = await db.query('SELECT event_type, amount_usd FROM cost_ledger WHERE project_id = $1', ['p1'])
    expect(ledger.rows).toEqual([{ event_type: 'VoiceSynthesized', amount_usd: '0.0007' }])
  })

  it('CaptionsBuilt records an ass_path on the scene and a caption asset', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
    await applyProjection(db, { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: '2026-07-09T00:00:02Z', sceneIdx: 0, assPath: '/m/0.ass' })
    const scene = await db.query('SELECT ass_path FROM scenes WHERE project_id = $1 AND idx = 0', ['p1'])
    expect(scene.rows[0]).toEqual({ ass_path: '/m/0.ass' })
  })

  it('CostProjected does not error and does not add to the ledger (observability only)', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'CostProjected', projectId: 'p1', at: '2026-07-09T00:00:01Z', projectedUsd: 0.01, capUsd: 0.15 })
    const ledger = await db.query('SELECT count(*)::int AS n FROM cost_ledger WHERE project_id = $1', ['p1'])
    expect(ledger.rows[0]).toEqual({ n: 0 })
  })

  it('AwaitingApproval / ApprovalGranted / RenderCompleted / Published / RunFailed drive status forward', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-09T00:00:01Z' })
    expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'awaiting_approval' })

    await applyProjection(db, { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: '2026-07-09T00:00:02Z' })
    let row = (await db.query('SELECT status, approved FROM projects WHERE project_id = $1', ['p1'])).rows[0]
    expect(row).toEqual({ status: 'approved', approved: true })

    await applyProjection(db, { v: 1, type: 'RenderCompleted', projectId: 'p1', at: '2026-07-09T00:00:03Z', outputPath: '/m/p1.mp4', renderUsd: 0 })
    row = (await db.query('SELECT status, output_path FROM projects WHERE project_id = $1', ['p1'])).rows[0]
    expect(row).toEqual({ status: 'rendered', output_path: '/m/p1.mp4' })
    const asset = await db.query(`SELECT kind, path FROM assets WHERE project_id = $1 AND kind = 'render'`, ['p1'])
    expect(asset.rows).toEqual([{ kind: 'render', path: '/m/p1.mp4' }])

    await applyProjection(db, { v: 1, type: 'Published', projectId: 'p1', at: '2026-07-09T00:00:04Z', platform: 'tiktok', postId: 'abc', url: 'https://x/abc' })
    expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'published' })
  })

  it('RunFailed sets status to failed', async () => {
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'RunFailed', projectId: 'p1', at: '2026-07-09T00:00:01Z', stage: 'render', error: 'ffmpeg exit 1' })
    expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'failed' })
  })
})

describe.skipIf(!up || !natsUp)('rebuildProjections (integration)', () => {
  it('TRUNCATE + replay from stream seq 0 fully reconstructs the read model', async () => {
    const bus = await connectBus(NATS_URL)
    await ensureStreams(bus.jsm)
    // rebuild replays the WHOLE stream from seq 0; the shared dev NATS may hold
    // stale events (e.g. other suites' placeholder `at:'t'`). Purge so this
    // hermetic test reconstructs only from its own known-ISO events.
    await bus.jsm.streams.purge(EVENTS_STREAM)
    const projectId = `p-${Date.now()}`
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId, at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' }
    const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId, at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }
    await publishEvent(bus.js, created)
    await publishEvent(bus.js, scripted)

    await rebuildProjections(bus.js, bus.jsm, db)
    const firstPass = await db.query('SELECT status FROM projects WHERE project_id = $1', [projectId])
    expect(firstPass.rows[0]).toEqual({ status: 'scripted' })

    // Prove it's re-derivable, not a one-shot fluke: wipe and rebuild again.
    await rebuildProjections(bus.js, bus.jsm, db)
    const secondPass = await db.query('SELECT status FROM projects WHERE project_id = $1', [projectId])
    expect(secondPass.rows[0]).toEqual({ status: 'scripted' })

    await bus.nc.drain()
  })
})
