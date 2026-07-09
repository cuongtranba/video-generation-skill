import { describe, it, expect, afterAll } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { connectBus, ensureStreams, createEventStore, EVENTS_STREAM, type Bus } from './nats.js'
import { createCommandContext } from './commands.js'
import { rebuildProjections } from './projections.js'
import { stubScriptGenerator } from './script.js'
import {
  createProject, generateScript, resolveMaterial, generateVoiceovers, requestApproval, approveStoryboard, publish,
} from './commands.js'
import { publishEvent } from './nats.js'
import type { VidgenEvent } from './events.js'

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4223'
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

// Probe both Postgres and NATS reachability once at module load (needs
// both local Postgres and local NATS) so the suite can be skipped cleanly.
const db: Database = createPool(DATABASE_URL)
let bus: Bus | null = null
let up = true
try {
  await db.query('SELECT 1')
  await migrate(db)
} catch {
  up = false
}
try {
  bus = await connectBus(NATS_URL)
  await ensureStreams(bus.jsm)
} catch {
  bus = null
}

describe.skipIf(!up || bus === null)('full command flow (integration)', () => {
  afterAll(async () => {
    await db.end()
    await bus?.nc.drain()
  })

  it('CreateProject → GenerateScript → ResolveMaterial → (worker fakes MaterialResolved) → GenerateVoiceovers → RequestApproval → ApproveStoryboard → (worker fakes RenderCompleted) → Publish, projected end to end', async () => {
    if (bus === null) return

    // rebuildProjections (below) replays the WHOLE stream from seq 0; the
    // shared dev NATS may hold stale events from other suites. Purge so this
    // hermetic flow reconstructs only from its own events.
    await bus.jsm.streams.purge(EVENTS_STREAM)

    const store = createEventStore(bus.js)
    const ctxCmd = createCommandContext(store, bus.js, stubScriptGenerator, 0.15)

    const { projectId } = await createProject(ctxCmd, { idea: 'nước ấm', durationSec: 30, sceneCount: 1, tone: 'casual' })
    let state = await generateScript(ctxCmd, { projectId })
    expect(state.status).toBe('scripted')

    await resolveMaterial(ctxCmd, { projectId })
    // The worker (P3) publishes MaterialResolved after resolving stock
    // footage; P1 has no worker yet, so fake that single event directly.
    const materialResolved: VidgenEvent = { v: 1, type: 'MaterialResolved', projectId, at: new Date().toISOString(), sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' }
    await publishEvent(bus.js, materialResolved)
    state = await generateVoiceovers(ctxCmd, { projectId }) // requires 'material' status — proves the fake above worked
    expect(state.status).toBe('material')

    state = await requestApproval(ctxCmd, { projectId })
    expect(state.status).toBe('awaiting_approval')

    state = await approveStoryboard(ctxCmd, { projectId })
    expect(state.status).toBe('approved')

    const renderCompleted: VidgenEvent = { v: 1, type: 'RenderCompleted', projectId, at: new Date().toISOString(), outputPath: `/media/${projectId}/out.mp4`, renderUsd: 0 }
    await publishEvent(bus.js, renderCompleted)

    state = await publish(ctxCmd, { projectId, caption: 'hi', privacy: 'public' })
    expect(state.status).toBe('published')

    // Rebuild the read model from the event log and confirm it agrees.
    await rebuildProjections(bus.js, bus.jsm, db)
    const row = await db.query('SELECT status, approved FROM projects WHERE project_id = $1', [projectId])
    expect(row.rows[0]).toEqual({ status: 'published', approved: true })
  }, 30_000) // each command folds the aggregate via a jetstream fetch that blocks
             // up to expires (1s); ~7 sequential loads + rebuild exceed the 5s default.
})
