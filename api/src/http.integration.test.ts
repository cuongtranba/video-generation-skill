import { describe, it, expect, afterAll } from 'bun:test'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection } from './projections.js'
import { listProjects, getProject } from './http.js'
import { createHttpServer } from './http.js'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import { createCommandContext } from './commands.js'
import type { ScriptGenerator } from './commands.js'
import type { Scene } from './events.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:00:01Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })

    const all = await listProjects(db)
    expect(all).toEqual([{ projectId: 'p1', idea: 'x', status: 'scripted', spentUsd: 0, approved: false, outputPath: null }])

    const one = await getProject(db, 'p1')
    expect(one?.scenes).toEqual([{ idx: 0, narration: 'a', visual: 'b', materialPath: null, mp3Path: null, assPath: null }])

    expect(await getProject(db, 'missing')).toBeNull()
  })
})

// Independent second probe (its own pool) for this describe's fixture,
// mirroring the `up`/`db` probe above (no local Postgres at DATABASE_URL).
const httpServerDb: Database = createPool(DATABASE_URL)
let httpServerUp = true
try {
  await httpServerDb.query('SELECT 1')
  await migrate(httpServerDb)
  await httpServerDb.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
} catch {
  httpServerUp = false
}

describe.skipIf(!httpServerUp)('createHttpServer (integration)', () => {
  afterAll(async () => {
    await httpServerDb.end()
  })

  it('serves POST /api/commands/CreateProject, GET /api/state, static SPA, and /media/*', async () => {
    const spaDir = mkdtempSync(path.join(tmpdir(), 'vidgen-spa-'))
    writeFileSync(path.join(spaDir, 'index.html'), '<html><body>vidgen</body></html>')
    const mediaDir = mkdtempSync(path.join(tmpdir(), 'vidgen-media-'))
    writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake-mp4-bytes')

    const store = createInMemoryEventStore()
    const fixedScriptGen: ScriptGenerator = { async generateScenes(): Promise<{ scenes: Scene[] }> { return { scenes: [] } } }
    const js = { async publish(): Promise<undefined> { return undefined } }
    const ctxCmd = createCommandContext(store, js, fixedScriptGen, 0.15)
    const server = createHttpServer({ db: httpServerDb, ctx: ctxCmd, spaDir, mediaDir, ttsProvider: 'elevenlabs' })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address')
    const base = `http://127.0.0.1:${address.port}`

    const createRes = await fetch(`${base}/api/commands/CreateProject`, {
      method: 'POST',
      body: JSON.stringify({ idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', idempotencyKey: 'k1' }),
    })
    expect(createRes.status).toBe(200)
    const created = (await createRes.json()) as { projectId: string }
    expect(typeof created.projectId).toBe('string')

    // Idempotency: replaying the same key returns the same cached result
    // without re-running the handler (which would append a second event).
    const replayRes = await fetch(`${base}/api/commands/CreateProject`, {
      method: 'POST',
      body: JSON.stringify({ idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', idempotencyKey: 'k1' }),
    })
    const replayed = (await replayRes.json()) as { projectId: string }
    expect(replayed.projectId).toBe(created.projectId)
    expect(store.events.filter((e) => e.type === 'ProjectCreated')).toHaveLength(1)

    const configRes = await fetch(`${base}/api/config`)
    expect(configRes.status).toBe(200)
    expect(await configRes.json()).toEqual({ ttsProvider: 'elevenlabs' })

    const spaRes = await fetch(`${base}/`)
    expect(spaRes.status).toBe(200)
    expect(await spaRes.text()).toContain('vidgen')

    const mediaRes = await fetch(`${base}/media/clip.mp4`)
    expect(mediaRes.status).toBe(200)
    expect(await mediaRes.text()).toBe('fake-mp4-bytes')

    const unknownCommandRes = await fetch(`${base}/api/commands/NotACommand`, { method: 'POST', body: '{}' })
    expect(unknownCommandRes.status).toBe(404)

    // A missing media file must 404 cleanly (not crash the process on an
    // unhandled ReadStream error).
    const missingMediaRes = await fetch(`${base}/media/does-not-exist.mp4`)
    expect(missingMediaRes.status).toBe(404)

    server.close()
  })
})
