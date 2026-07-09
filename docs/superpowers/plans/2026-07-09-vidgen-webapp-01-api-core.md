# P1 — api-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript `api` service — NATS JetStream event store wiring, Postgres read-model schema, the `Project` aggregate with invariant guards, the 7 frozen command handlers, projections, the cost wall, and a minimal HTTP layer — as the foundation every other webapp-rewrite subsystem (P2–P5) builds on.

**Architecture:** Event-sourced CQRS. `api` is the only writer to stream `VIDGEN_EVENTS` (source of truth); commands fold the aggregate from that stream, check invariants + cost admissibility, then append event(s) and/or dispatch job(s) to `VIDGEN_JOBS`. A durable consumer folds `VIDGEN_EVENTS` into disposable Postgres read-model tables. A tiny `node:http` router serves commands, baseline reads, the SPA, and `/media/*`.

**Tech Stack:** Node.js (TypeScript, ESM/NodeNext), `@nats-io/transport-node` + `@nats-io/jetstream` (verified against Context7 `/nats-io/nats.js`), `pg` (verified against Context7 `/brianc/node-postgres`), `vitest` (verified against Context7 `/vitest-dev/vitest`), Postgres 16, Docker Compose.

---

## Ground truth (frozen — do not redefine)

- `docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md` — §3 layout, §4 events, §5 commands, §6 cost rule, §7 imports, §8 runtime env.
- `docs/superpowers/specs/2026-07-09-vidgen-webapp-event-store-design.md` — event-store design.
- `spikes/event-model/events.ts` — the `VidgenEvent` union + `foldProject`, promoted verbatim to `api/src/events.ts`.
- `spikes/nats-ws/publisher.ts` — Context7-confirmed Node publish shape (`connect` from `@nats-io/transport-node`, `jetstream` from `@nats-io/jetstream`, `js.publish(subject, data, { msgID })`).
- `spikes/go-worker/main.go` — Go-side idempotency contract this plan's Node side must interoperate with (`WithMsgID`, dupe window, `OrderedConsumer`+`FilterSubjects`).
- `internal/cost/estimator.go` (`FPTAIPerChar = 0.000010`) and `internal/cost/ledger.go` (`CapUSD`) — the Go CLI's existing, proven cost constants. `api/src/cost.ts` reuses `FPTAIPerChar`'s *value* (renamed `FPT_TTS_USD_PER_CHAR`) so TS and Go agree on the real per-char TTS price; the cap itself becomes `COST_CAP_USD` env (default **0.15**, not `0.10`) per index §6.

## Local dev prerequisites (read before Task 1)

Several tasks include integration tests that need a live NATS and/or Postgres. Start them once, before running `npm test` in `api/`:

```bash
docker compose up -d nats
```

Postgres isn't in `docker-compose.yml` yet — Task 21 adds it. Until then, run a throwaway Postgres for the integration tests in Tasks 3, 9, 16–18, 20, 22:

```bash
docker run -d --name vidgen-test-pg -e POSTGRES_USER=vidgen -e POSTGRES_PASSWORD=vidgen -e POSTGRES_DB=vidgen -p 5433:5432 postgres:16-alpine
```

Every integration test in this plan checks reachability at the top of the test and calls `ctx.skip(...)` with a message if the service isn't up — so `npm test` stays green with zero services running, and exercises the real wire protocol when they are. Env vars, with their defaults if unset:

- `NATS_URL` → `nats://localhost:4223` (host-mapped port per index §8; compose sets this to `nats://nats:4222` for the `api` container).
- `DATABASE_URL` → `postgres://vidgen:vidgen@localhost:5433/vidgen` (compose sets this to `postgres://vidgen:vidgen@postgres:5432/vidgen` for the `api` container).

---

## Task 1: Scaffold `api/`

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/vitest.config.ts`
- Create: `api/.gitignore`
- Create: `api/src/.gitkeep`

- [ ] **Step 1: Create the directory and `package.json`**

Run: `mkdir -p api/src api/migrations`

Write `api/package.json`:

```json
{
  "name": "api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nats-io/jetstream": "^3.4.0",
    "@nats-io/transport-node": "^3.4.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "@types/pg": "^8.11.10",
    "tsx": "^4.23.0",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Write `api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

Write `api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `.gitignore` and a placeholder so `src/` is tracked**

Write `api/.gitignore`:

```
node_modules/
dist/
*.log
```

Write `api/src/.gitkeep`:

```
```

- [ ] **Step 5: Install dependencies**

Run: `cd api && npm install`
Expected: exits 0, `api/node_modules/` and `api/package-lock.json` are created, no error output.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/tsconfig.json api/vitest.config.ts api/.gitignore api/src/.gitkeep
git commit -m "chore(api): scaffold TypeScript service (package.json, tsconfig, vitest)"
```

---

## Task 2: Promote `events.ts`

**Files:**
- Create: `api/src/events.ts`
- Test: `api/src/events.test.ts`

- [ ] **Step 1: Write the failing test (ported from `spikes/event-model/events_test.ts`)**

Write `api/src/events.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { foldProject, type VidgenEvent } from './events.js'

describe('foldProject', () => {
  it('folds a lifecycle into current state', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:01:00Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0.012 },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-09T00:02:00Z' },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: '2026-07-09T00:03:00Z' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at: '2026-07-09T00:04:00Z', outputPath: '/m/p1.mp4', renderUsd: 0.004 },
    ]
    const s = foldProject(events)
    expect(s.status).toBe('rendered')
    expect(s.spentUsd).toBeCloseTo(0.016)
    expect(s.approved).toBe(true)
    expect(s.outputPath).toBe('/m/p1.mp4')
  })

  it('reports awaiting_approval before approval', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't' },
    ])
    expect(s.status).toBe('awaiting_approval')
    expect(s.approved).toBe(false)
  })

  it('leaves status/projectId at defaults for an empty log', () => {
    const s = foldProject([])
    expect(s.projectId).toBe('')
    expect(s.status).toBe('draft')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/events.test.ts`
Expected: FAIL — `Cannot find module './events.js'` (file doesn't exist yet).

- [ ] **Step 3: Promote `events.ts` verbatim from the spike**

Write `api/src/events.ts` (byte-identical to `spikes/event-model/events.ts` — this is a frozen contract, not authored here):

```ts
export type Scene = { idx: number; narration: string; visual: string }

export type VidgenEvent =
  | { v: 1; type: 'ProjectCreated'; projectId: string; at: string; idea: string; durationSec: number; sceneCount: number; tone: string }
  | { v: 1; type: 'ScriptGenerated'; projectId: string; at: string; scenes: Scene[]; scriptUsd: number }
  | { v: 1; type: 'MaterialResolved'; projectId: string; at: string; sceneIdx: number; source: string; assetPath: string }
  | { v: 1; type: 'VoiceSynthesized'; projectId: string; at: string; sceneIdx: number; mp3Path: string; ttsUsd: number }
  | { v: 1; type: 'CaptionsBuilt'; projectId: string; at: string; sceneIdx: number; assPath: string }
  | { v: 1; type: 'CostProjected'; projectId: string; at: string; projectedUsd: number; capUsd: number }
  | { v: 1; type: 'AwaitingApproval'; projectId: string; at: string }
  | { v: 1; type: 'ApprovalGranted'; projectId: string; at: string }
  | { v: 1; type: 'RenderCompleted'; projectId: string; at: string; outputPath: string; renderUsd: number }
  | { v: 1; type: 'Published'; projectId: string; at: string; platform: string; postId: string; url: string }
  | { v: 1; type: 'RunFailed'; projectId: string; at: string; stage: string; error: string }

export type ProjectStatus = 'draft' | 'material' | 'scripted' | 'awaiting_approval' | 'approved' | 'rendered' | 'published' | 'failed'

export type ProjectState = { projectId: string; status: ProjectStatus; scenes: Scene[]; spentUsd: number; approved: boolean; outputPath?: string }

export function foldProject(events: VidgenEvent[]): ProjectState {
  const s: ProjectState = { projectId: '', status: 'draft', scenes: [], spentUsd: 0, approved: false }
  for (const e of events) {
    s.projectId = e.projectId
    switch (e.type) {
      case 'ProjectCreated': s.status = 'draft'; break
      case 'ScriptGenerated': s.scenes = e.scenes; s.spentUsd += e.scriptUsd; s.status = 'scripted'; break
      case 'MaterialResolved': s.status = 'material'; break
      case 'VoiceSynthesized': s.spentUsd += e.ttsUsd; break
      case 'CaptionsBuilt': break
      case 'AwaitingApproval': s.status = 'awaiting_approval'; break
      case 'ApprovalGranted': s.approved = true; s.status = 'approved'; break
      case 'RenderCompleted': s.spentUsd += e.renderUsd; s.outputPath = e.outputPath; s.status = 'rendered'; break
      case 'Published': s.status = 'published'; break
      case 'RunFailed': s.status = 'failed'; break
    }
  }
  return s
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/events.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/events.ts api/src/events.test.ts
git commit -m "feat(api): promote VidgenEvent union + foldProject from spikes/event-model"
```

---

## Task 3: `db.ts` — Postgres pool + migration runner

**Files:**
- Create: `api/migrations/001_init.sql`
- Create: `api/src/db.ts`
- Test: `api/src/db.test.ts`

- [ ] **Step 1: Write the migration SQL first (the test depends on it existing on disk)**

Write `api/migrations/001_init.sql`:

```sql
-- Read-model tables folded from VIDGEN_EVENTS by api/src/projections.ts.
-- Postgres is disposable: TRUNCATE + replay from stream seq 0 fully
-- rebuilds these tables (see projections.rebuildProjections). Every
-- statement is idempotent so this file can be re-run safely.

CREATE TABLE IF NOT EXISTS projects (
  project_id   TEXT PRIMARY KEY,
  idea         TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  scene_count  INTEGER NOT NULL,
  tone         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  spent_usd    NUMERIC(10,4) NOT NULL DEFAULT 0,
  approved     BOOLEAN NOT NULL DEFAULT FALSE,
  output_path  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenes (
  project_id      TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  narration       TEXT NOT NULL,
  visual          TEXT NOT NULL,
  material_source TEXT,
  material_path   TEXT,
  mp3_path        TEXT,
  tts_usd         NUMERIC(10,4),
  ass_path        TEXT,
  PRIMARY KEY (project_id, idx)
);

CREATE TABLE IF NOT EXISTS assets (
  id         SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  scene_idx  INTEGER,
  kind       TEXT NOT NULL CHECK (kind IN ('material', 'voice', 'caption', 'render')),
  path       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- scene_idx is NULL for project-level assets (render output). Postgres
-- treats NULLs as distinct in a plain UNIQUE constraint, which would break
-- idempotent re-application of RenderCompleted during replay — so dedupe
-- on COALESCE(scene_idx, -1) instead of the raw column.
CREATE UNIQUE INDEX IF NOT EXISTS assets_dedup_idx
  ON assets (project_id, kind, COALESCE(scene_idx, -1));

CREATE TABLE IF NOT EXISTS cost_ledger (
  id         SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  scene_idx  INTEGER,
  amount_usd NUMERIC(10,4) NOT NULL,
  at         TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_ledger_dedup_idx
  ON cost_ledger (project_id, event_type, COALESCE(scene_idx, -1));
```

- [ ] **Step 2: Write the failing test**

Write `api/src/db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, migrate, type Database } from './db.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

describe('migrate', () => {
  let db: Database
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
    } catch {
      reachable = false
    }
  })

  afterAll(async () => {
    await db.end()
  })

  it('creates projects, scenes, assets, cost_ledger tables', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    await migrate(db)
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )
    const tables = result.rows.map((r) => r.table_name)
    expect(tables).toEqual(expect.arrayContaining(['projects', 'scenes', 'assets', 'cost_ledger']))
  })

  it('is idempotent — running migrate twice does not error', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    await migrate(db)
    await expect(migrate(db)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && npx vitest run src/db.test.ts`
Expected: FAIL — `Cannot find module './db.js'`.

- [ ] **Step 4: Implement `db.ts`**

Write `api/src/db.ts`:

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export type Database = pg.Pool

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createPool(connectionString: string): Database {
  return new pg.Pool({ connectionString })
}

export async function migrate(db: Database): Promise<void> {
  const sqlPath = path.join(__dirname, '..', 'migrations', '001_init.sql')
  const sql = await readFile(sqlPath, 'utf8')
  await db.query(sql)
}
```

- [ ] **Step 5: Start a throwaway Postgres and run the test to verify it passes**

Run: `docker run -d --name vidgen-test-pg -e POSTGRES_USER=vidgen -e POSTGRES_PASSWORD=vidgen -e POSTGRES_DB=vidgen -p 5433:5432 postgres:16-alpine`
Expected: prints a container id.

Run: `cd api && npx vitest run src/db.test.ts`
Expected: PASS — 2 tests passed (not skipped).

- [ ] **Step 6: Commit**

```bash
git add api/migrations/001_init.sql api/src/db.ts api/src/db.test.ts
git commit -m "feat(api): add Postgres pool + idempotent migrate() with read-model schema"
```

---

## Task 4: `nats.ts` — connect + ensure streams

**Files:**
- Create: `api/src/nats.ts`
- Test: `api/src/nats.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Write `api/src/nats.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { connectBus, ensureStreams, EVENTS_STREAM, JOBS_STREAM, type Bus } from './nats.js'

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4223'

async function tryConnectBus(): Promise<Bus | null> {
  try {
    return await connectBus(NATS_URL)
  } catch {
    return null
  }
}

describe('connectBus + ensureStreams (integration)', () => {
  it('creates VIDGEN_EVENTS and VIDGEN_JOBS, and is idempotent', async (ctx) => {
    const bus = await tryConnectBus()
    ctx.skip(bus === null, `no local NATS at ${NATS_URL}`)
    if (!bus) return
    await ensureStreams(bus.jsm)
    await ensureStreams(bus.jsm) // second call must not throw
    const events = await bus.jsm.streams.info(EVENTS_STREAM)
    const jobs = await bus.jsm.streams.info(JOBS_STREAM)
    expect(events.config.name).toBe(EVENTS_STREAM)
    expect(events.config.subjects).toEqual(['vidgen.evt.>'])
    expect(jobs.config.name).toBe(JOBS_STREAM)
    expect(jobs.config.subjects).toEqual(['vidgen.job.>'])
    await bus.nc.drain()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/nats.integration.test.ts`
Expected: FAIL — `Cannot find module './nats.js'`.

- [ ] **Step 3: Implement `connectBus` and `ensureStreams`**

Write `api/src/nats.ts`:

```ts
import { connect, type NatsConnection } from '@nats-io/transport-node'
import {
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream'

export const EVENTS_STREAM = 'VIDGEN_EVENTS'
export const JOBS_STREAM = 'VIDGEN_JOBS'
/** Matches index.md §4 "dupe-window 2m" — 2 minutes in nanoseconds. */
export const DUPLICATE_WINDOW_NS = 2 * 60 * 1_000_000_000

export interface Bus {
  nc: NatsConnection
  js: JetStreamClient
  jsm: JetStreamManager
}

export async function connectBus(servers: string): Promise<Bus> {
  const nc = await connect({ servers })
  const js = jetstream(nc)
  const jsm = await jetstreamManager(nc)
  return { nc, js, jsm }
}

async function ensureStream(jsm: JetStreamManager, config: Partial<StreamConfig> & { name: string }): Promise<void> {
  try {
    await jsm.streams.info(config.name)
  } catch {
    await jsm.streams.add(config)
  }
}

export async function ensureStreams(jsm: JetStreamManager): Promise<void> {
  await ensureStream(jsm, {
    name: EVENTS_STREAM,
    subjects: ['vidgen.evt.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    duplicate_window: DUPLICATE_WINDOW_NS,
  })
  await ensureStream(jsm, {
    name: JOBS_STREAM,
    subjects: ['vidgen.job.>'],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose up -d nats` then `cd api && npx vitest run src/nats.integration.test.ts`
Expected: PASS — 1 test passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/nats.ts api/src/nats.integration.test.ts
git commit -m "feat(api): connectBus + idempotent ensureStreams for VIDGEN_EVENTS/VIDGEN_JOBS"
```

---

## Task 5: `nats.ts` — `publishEvent` and `dispatchJob`

**Files:**
- Modify: `api/src/nats.ts`
- Create: `api/src/nats.test.ts`
- Modify: `api/src/nats.integration.test.ts`

- [ ] **Step 1: Write the failing unit tests for the pure subject/id builders**

Write `api/src/nats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { eventId, eventSubject, jobSubject } from './nats.js'
import type { VidgenEvent } from './events.js'

describe('eventId', () => {
  it('uses the scene idx when the event carries one', () => {
    const event: VidgenEvent = { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: 't', sceneIdx: 2, mp3Path: '/m.mp3', ttsUsd: 0.001 }
    expect(eventId(event)).toBe('VoiceSynthesized-p1-2')
  })

  it("uses '-' when the event has no scene idx", () => {
    const event: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' }
    expect(eventId(event)).toBe('ProjectCreated-p1--')
  })
})

describe('eventSubject', () => {
  it('builds vidgen.evt.<projectId>.<type>', () => {
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't' }
    expect(eventSubject(event)).toBe('vidgen.evt.p1.AwaitingApproval')
  })
})

describe('jobSubject', () => {
  it('builds vidgen.job.<kind>.<projectId>.<scene>', () => {
    expect(jobSubject('tts', 'p1', 2)).toBe('vidgen.job.tts.p1.2')
  })

  it("uses '-' for a project-level job with no scene", () => {
    expect(jobSubject('render', 'p1', null)).toBe('vidgen.job.render.p1.-')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/nats.test.ts`
Expected: FAIL — `eventId is not exported`.

- [ ] **Step 3: Implement `eventId`, `eventSubject`, `publishEvent`, `jobSubject`, `dispatchJob`**

Add to `api/src/nats.ts` (append after `ensureStreams`; add `VidgenEvent` to the existing import from `./events.js` — this is a new import line):

```ts
import type { VidgenEvent } from './events.js'

export type JobKind = 'material' | 'tts' | 'caption' | 'render'

/** Minimal publish capability — satisfied by the real JetStreamClient and by
 * test fakes, so command-handler unit tests never need a live NATS server. */
export interface Publisher {
  publish(subject: string, data: string, opts?: { msgID?: string }): Promise<unknown>
}

/** Deterministic per-fact id (index.md §4): `<type>-<projectId>-<sceneIdx|'-'>`.
 * The stream's 2-minute dupe window collapses repeated publishes of the same
 * logical fact into a single stored event, so worker/command retries never
 * double-append. */
export function eventId(event: VidgenEvent): string {
  const sceneIdx = 'sceneIdx' in event ? String(event.sceneIdx) : '-'
  return `${event.type}-${event.projectId}-${sceneIdx}`
}

export function eventSubject(event: VidgenEvent): string {
  return `vidgen.evt.${event.projectId}.${event.type}`
}

export async function publishEvent(js: Publisher, event: VidgenEvent): Promise<void> {
  await js.publish(eventSubject(event), JSON.stringify(event), { msgID: eventId(event) })
}

export function jobSubject(kind: JobKind, projectId: string, sceneIdx: number | null): string {
  const scene = sceneIdx === null ? '-' : String(sceneIdx)
  return `vidgen.job.${kind}.${projectId}.${scene}`
}

export interface JobPayload {
  projectId: string
  sceneIdx: number | null
  [key: string]: unknown
}

export async function dispatchJob(
  js: Publisher,
  kind: JobKind,
  projectId: string,
  sceneIdx: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const scene = sceneIdx === null ? '-' : String(sceneIdx)
  const body: JobPayload = { projectId, sceneIdx, ...payload }
  await js.publish(jobSubject(kind, projectId, sceneIdx), JSON.stringify(body), { msgID: `${kind}-${projectId}-${scene}` })
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd api && npx vitest run src/nats.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Add and run an integration test proving dupe-window + job dispatch against real NATS**

Append to `api/src/nats.integration.test.ts` (add these imports to the existing import line, and add the new `describe` block):

```ts
import { randomUUID } from 'node:crypto'
import { publishEvent, dispatchJob, EVENTS_STREAM, JOBS_STREAM } from './nats.js'
import type { VidgenEvent } from './events.js'
```

```ts
describe('publishEvent + dispatchJob (integration)', () => {
  it('republishing the same event does not double-append (dupe window)', async (ctx) => {
    const bus = await tryConnectBus()
    ctx.skip(bus === null, `no local NATS at ${NATS_URL}`)
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId, at: 't' }
    await publishEvent(bus.js, event)
    await publishEvent(bus.js, event)
    const consumer = await bus.js.consumers.get(EVENTS_STREAM, { filterSubjects: [`vidgen.evt.${projectId}.AwaitingApproval`] })
    const batch = await consumer.fetch({ max_messages: 10, expires: 1500 })
    let count = 0
    for await (const m of batch) {
      count++
      m.ack()
    }
    expect(count).toBe(1)
    await bus.nc.drain()
  })

  it('dispatchJob publishes to vidgen.job.<kind>.<projectId>.<scene>', async (ctx) => {
    const bus = await tryConnectBus()
    ctx.skip(bus === null, `no local NATS at ${NATS_URL}`)
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    await dispatchJob(bus.js, 'material', projectId, 0, { visual: 'b' })
    const consumer = await bus.js.consumers.get(JOBS_STREAM, { filterSubjects: [`vidgen.job.material.${projectId}.0`] })
    const batch = await consumer.fetch({ max_messages: 1, expires: 1500 })
    const seen: string[] = []
    for await (const m of batch) {
      seen.push(m.subject)
      m.ack()
    }
    expect(seen).toEqual([`vidgen.job.material.${projectId}.0`])
    await bus.nc.drain()
  })
})
```

Run: `cd api && npx vitest run src/nats.integration.test.ts`
Expected: PASS — 3 tests passed (not skipped).

- [ ] **Step 6: Commit**

```bash
git add api/src/nats.ts api/src/nats.test.ts api/src/nats.integration.test.ts
git commit -m "feat(api): publishEvent + dispatchJob with deterministic msgID scheme"
```

---

## Task 6: `nats.ts` — durable consumer, `consumeEvents`, `createEventStore`

**Files:**
- Modify: `api/src/nats.ts`
- Modify: `api/src/nats.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `api/src/nats.integration.test.ts` (add these to the existing import line):

```ts
import { ensureDurableConsumer, deleteDurableConsumer, consumeEvents, createEventStore } from './nats.js'
```

```ts
describe('durable consumer + createEventStore (integration)', () => {
  it('createEventStore loads a project log in stream order', async (ctx) => {
    const bus = await tryConnectBus()
    ctx.skip(bus === null, `no local NATS at ${NATS_URL}`)
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId, at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId, at: '2026-07-09T00:01:00Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }
    await publishEvent(bus.js, created)
    await publishEvent(bus.js, scripted)
    const store = createEventStore(bus.js)
    const events = await store.loadEvents(projectId)
    expect(events.map((e) => e.type)).toEqual(['ProjectCreated', 'ScriptGenerated'])
    await bus.nc.drain()
  })

  it('consumeEvents on a durable consumer delivers backlog and new events', async (ctx) => {
    const bus = await tryConnectBus()
    ctx.skip(bus === null, `no local NATS at ${NATS_URL}`)
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const durable = `test-consume-${projectId}`
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId, at: 't' }
    await publishEvent(bus.js, event)
    await ensureDurableConsumer(bus.jsm, durable)
    const seen: VidgenEvent[] = []
    const consumePromise = consumeEvents(bus.js, durable, async (e) => {
      seen.push(e)
    })
    consumePromise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(seen.some((e) => e.projectId === projectId && e.type === 'AwaitingApproval')).toBe(true)
    await deleteDurableConsumer(bus.jsm, durable)
    await bus.nc.drain()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/nats.integration.test.ts`
Expected: FAIL — `ensureDurableConsumer is not exported`.

- [ ] **Step 3: Implement the durable consumer helpers, `consumeEvents`, and `createEventStore`**

Add to `api/src/nats.ts` (append at the end; extend the existing `@nats-io/jetstream` import with `AckPolicy`, `DeliverPolicy`):

```ts
import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream'

export async function ensureDurableConsumer(jsm: JetStreamManager, durableName: string): Promise<void> {
  try {
    await jsm.consumers.info(EVENTS_STREAM, durableName)
  } catch {
    await jsm.consumers.add(EVENTS_STREAM, {
      durable_name: durableName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    })
  }
}

export async function deleteDurableConsumer(jsm: JetStreamManager, durableName: string): Promise<void> {
  try {
    await jsm.consumers.delete(EVENTS_STREAM, durableName)
  } catch {
    // already gone — fine
  }
}

/** Long-running: resolves only when the underlying subscription ends (e.g.
 * on nc.drain()). Callers run this as a background loop, not awaited inline. */
export async function consumeEvents(
  js: JetStreamClient,
  durableName: string,
  handler: (event: VidgenEvent, seq: number) => Promise<void>,
): Promise<void> {
  const c = await js.consumers.get(EVENTS_STREAM, durableName)
  const msgs = await c.consume()
  for await (const m of msgs) {
    try {
      const event = m.json<VidgenEvent>()
      await handler(event, m.seq)
      m.ack()
    } catch (err) {
      console.error(`consumeEvents: handler failed for seq ${m.seq}:`, err)
      m.nak()
    }
  }
}

export interface EventStore {
  loadEvents(projectId: string): Promise<VidgenEvent[]>
  append(event: VidgenEvent): Promise<void>
}

/** Reads a project's log directly from VIDGEN_EVENTS (the source of truth),
 * via an ephemeral ordered consumer filtered to that project's subjects. */
export function createEventStore(js: JetStreamClient): EventStore {
  return {
    async loadEvents(projectId: string): Promise<VidgenEvent[]> {
      const consumer = await js.consumers.get(EVENTS_STREAM, { filterSubjects: [`vidgen.evt.${projectId}.>`] })
      const events: VidgenEvent[] = []
      const batch = await consumer.fetch({ max_messages: 10_000, expires: 500 })
      for await (const m of batch) {
        events.push(m.json<VidgenEvent>())
      }
      return events
    },
    async append(event: VidgenEvent): Promise<void> {
      await publishEvent(js, event)
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/nats.integration.test.ts`
Expected: PASS — 5 tests passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/nats.ts api/src/nats.integration.test.ts
git commit -m "feat(api): durable consumer helpers, consumeEvents, createEventStore"
```

---

## Task 7: `aggregate.ts` — invariant guards

**Files:**
- Create: `api/src/aggregate.ts`
- Test: `api/src/aggregate.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `api/src/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { VidgenEvent } from './events.js'
import {
  assertCanCreate,
  assertExists,
  assertTransition,
  InvalidTransitionError,
  ProjectNotFoundError,
  ProjectAlreadyExistsError,
} from './aggregate.js'

const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }

describe('assertCanCreate', () => {
  it('allows creating a project with no prior events', () => {
    expect(() => assertCanCreate([], 'p1')).not.toThrow()
  })

  it('rejects creating a project that already has events', () => {
    expect(() => assertCanCreate([created], 'p1')).toThrow(ProjectAlreadyExistsError)
  })
})

describe('assertExists', () => {
  it('throws ProjectNotFoundError for an empty log', () => {
    expect(() => assertExists([], 'p1')).toThrow(ProjectNotFoundError)
  })

  it('returns the folded state for a non-empty log', () => {
    const state = assertExists([created], 'p1')
    expect(state.status).toBe('draft')
  })
})

describe('assertTransition', () => {
  it('allows GenerateScript from draft', () => {
    const state = assertExists([created], 'p1')
    expect(() => assertTransition('GenerateScript', state)).not.toThrow()
  })

  it('rejects GenerateScript from scripted (already scripted)', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('GenerateScript', state)).toThrow(InvalidTransitionError)
  })

  it('allows ResolveMaterial from scripted', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('ResolveMaterial', state)).not.toThrow()
  })

  it('rejects Publish before rendered', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('Publish', state)).toThrow(InvalidTransitionError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/aggregate.test.ts`
Expected: FAIL — `Cannot find module './aggregate.js'`.

- [ ] **Step 3: Implement `aggregate.ts`**

Write `api/src/aggregate.ts`:

```ts
import { foldProject } from './events.js'
import type { VidgenEvent, ProjectState } from './events.js'

export { foldProject }
export type { ProjectState }

export type CommandName =
  | 'CreateProject'
  | 'GenerateScript'
  | 'ResolveMaterial'
  | 'GenerateVoiceovers'
  | 'RequestApproval'
  | 'ApproveStoryboard'
  | 'Publish'

export class ProjectAlreadyExistsError extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId} already has events`)
    this.name = 'ProjectAlreadyExistsError'
  }
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId} has no events`)
    this.name = 'ProjectNotFoundError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(public readonly command: CommandName, public readonly from: ProjectState['status']) {
    super(`command ${command} is not legal from status "${from}"`)
    this.name = 'InvalidTransitionError'
  }
}

/** Legal status a command may run from. Mirrors the linear pipeline the Go
 * CLI already proved (draft→scripted→material→awaiting_approval→approved→
 * rendered→published), renamed to the frozen ProjectStatus values. */
const LEGAL_FROM: Record<Exclude<CommandName, 'CreateProject'>, ReadonlyArray<ProjectState['status']>> = {
  GenerateScript: ['draft'],
  ResolveMaterial: ['scripted'],
  GenerateVoiceovers: ['material'],
  RequestApproval: ['material'],
  ApproveStoryboard: ['awaiting_approval'],
  Publish: ['rendered'],
}

export function assertCanCreate(events: VidgenEvent[], projectId: string): void {
  if (events.length > 0) {
    throw new ProjectAlreadyExistsError(projectId)
  }
}

export function assertExists(events: VidgenEvent[], projectId: string): ProjectState {
  if (events.length === 0) {
    throw new ProjectNotFoundError(projectId)
  }
  return foldProject(events)
}

export function assertTransition(command: Exclude<CommandName, 'CreateProject'>, state: ProjectState): void {
  if (!LEGAL_FROM[command].includes(state.status)) {
    throw new InvalidTransitionError(command, state.status)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/aggregate.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/aggregate.ts api/src/aggregate.test.ts
git commit -m "feat(api): aggregate invariant guards (exists/not-exists/legal transition)"
```

---

## Task 8: `cost.ts` — pure cost functions

**Files:**
- Create: `api/src/cost.ts`
- Test: `api/src/cost.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `api/src/cost.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Scene, ProjectState } from './events.js'
import { FPT_TTS_USD_PER_CHAR, DEFAULT_COST_CAP_USD, costCapFromEnv, projectedTtsUsd, admit } from './cost.js'

const emptyState: ProjectState = { projectId: 'p1', status: 'material', scenes: [], spentUsd: 0, approved: false }

describe('costCapFromEnv', () => {
  it('defaults to 0.15 when COST_CAP_USD is unset', () => {
    expect(costCapFromEnv({})).toBe(DEFAULT_COST_CAP_USD)
  })

  it('reads a valid COST_CAP_USD', () => {
    expect(costCapFromEnv({ COST_CAP_USD: '0.25' })).toBe(0.25)
  })

  it('falls back to the default on garbage input', () => {
    expect(costCapFromEnv({ COST_CAP_USD: 'not-a-number' })).toBe(DEFAULT_COST_CAP_USD)
  })
})

describe('projectedTtsUsd', () => {
  it('is chars × FPT_TTS_USD_PER_CHAR, counting Vietnamese diacritics as one char each', () => {
    const scenes: Scene[] = [{ idx: 0, narration: 'nước ấm', visual: 'v' }] // 7 chars
    expect(projectedTtsUsd(scenes)).toBeCloseTo(7 * FPT_TTS_USD_PER_CHAR)
  })

  it('is 0 for no scenes', () => {
    expect(projectedTtsUsd([])).toBe(0)
  })
})

describe('admit', () => {
  it('admits when projected spend is at or under the cap', () => {
    const result = admit(emptyState, 0.15, 0.15)
    expect(result.admitted).toBe(true)
    expect(result.projectedUsd).toBeCloseTo(0.15)
  })

  it('vetoes when projected spend exceeds the cap', () => {
    const result = admit(emptyState, 0.16, 0.15)
    expect(result.admitted).toBe(false)
  })

  it('adds to existing spend, not just the new amount', () => {
    const spent: ProjectState = { ...emptyState, spentUsd: 0.1 }
    const result = admit(spent, 0.1, 0.15)
    expect(result.admitted).toBe(false)
    expect(result.projectedUsd).toBeCloseTo(0.2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/cost.test.ts`
Expected: FAIL — `Cannot find module './cost.js'`.

- [ ] **Step 3: Implement the pure functions in `cost.ts`**

Write `api/src/cost.ts`:

```ts
import type { Scene, ProjectState } from './events.js'

/** Real FPT.AI TTS price per character, in USD. Mirrors
 * internal/cost/estimator.go's FPTAIPerChar — keep both in sync if the FPT
 * rate card changes. This is the ONLY enforced per-scene cost input; Agent
 * SDK notional cost never enters this calculation (index.md §6, BINDING). */
export const FPT_TTS_USD_PER_CHAR = 0.00001

export const DEFAULT_COST_CAP_USD = 0.15

export function costCapFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.COST_CAP_USD
  if (raw === undefined || raw === '') return DEFAULT_COST_CAP_USD
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COST_CAP_USD
}

export function projectedTtsUsd(scenes: Scene[]): number {
  const chars = scenes.reduce((sum, s) => sum + [...s.narration].length, 0)
  return chars * FPT_TTS_USD_PER_CHAR
}

export interface AdmitResult {
  admitted: boolean
  projectedUsd: number
  capUsd: number
}

/** Admissibility gate (spec §2.4 step 3 / §5.4): projects the total after
 * adding `additionalUsd` to what's already spent, and vetoes — dry-run, no
 * side effect — if that total would exceed the cap. */
export function admit(state: ProjectState, additionalUsd: number, capUsd: number): AdmitResult {
  const projectedUsd = state.spentUsd + additionalUsd
  return { admitted: projectedUsd <= capUsd, projectedUsd, capUsd }
}

export class CostCapExceededError extends Error {
  constructor(public readonly projectedUsd: number, public readonly capUsd: number) {
    super(`projected cost $${projectedUsd.toFixed(4)} exceeds cap $${capUsd.toFixed(2)}`)
    this.name = 'CostCapExceededError'
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/cost.test.ts`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/cost.ts api/src/cost.test.ts
git commit -m "feat(api): cost wall — projectedTtsUsd, admit, costCapFromEnv"
```

---

## Task 9: `cost.ts` — `readLedger`

**Files:**
- Modify: `api/src/cost.ts`
- Create: `api/src/cost.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Write `api/src/cost.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, migrate, type Database } from './db.js'
import { readLedger } from './cost.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

describe('readLedger (integration)', () => {
  let db: Database
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
      await migrate(db)
    } catch {
      reachable = false
    }
  })

  afterAll(async () => {
    await db.end()
  })

  it('reads ledger rows for a project in chronological order', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/cost.integration.test.ts`
Expected: FAIL — `readLedger is not exported`.

- [ ] **Step 3: Implement `readLedger`**

Add to `api/src/cost.ts` (append at the end; add this import at the top):

```ts
import type { Database } from './db.js'
```

```ts
export interface LedgerEntry {
  eventType: string
  sceneIdx: number | null
  amountUsd: number
  at: string
}

export async function readLedger(db: Database, projectId: string): Promise<LedgerEntry[]> {
  const result = await db.query<{ event_type: string; scene_idx: number | null; amount_usd: string; at: Date }>(
    'SELECT event_type, scene_idx, amount_usd, at FROM cost_ledger WHERE project_id = $1 ORDER BY at ASC',
    [projectId],
  )
  return result.rows.map((row) => ({
    eventType: row.event_type,
    sceneIdx: row.scene_idx,
    amountUsd: Number(row.amount_usd),
    at: row.at.toISOString(),
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/cost.integration.test.ts`
Expected: PASS — 1 test passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/cost.ts api/src/cost.integration.test.ts
git commit -m "feat(api): readLedger — actual-cost read from the Postgres projection"
```

---

## Task 10: `commands.ts` — scaffolding + `CreateProject`

**Files:**
- Create: `api/src/testutil/inMemoryEventStore.ts`
- Create: `api/src/commands.ts`
- Test: `api/src/commands.test.ts`

- [ ] **Step 1: Create the in-memory `EventStore` fake used by every command test**

Write `api/src/testutil/inMemoryEventStore.ts`:

```ts
import type { VidgenEvent } from '../events.js'
import type { EventStore } from '../nats.js'

export function createInMemoryEventStore(seed: VidgenEvent[] = []): EventStore & { events: VidgenEvent[] } {
  const events = [...seed]
  return {
    events,
    async loadEvents(projectId: string): Promise<VidgenEvent[]> {
      return events.filter((e) => e.projectId === projectId)
    },
    async append(event: VidgenEvent): Promise<void> {
      events.push(event)
    },
  }
}
```

- [ ] **Step 2: Write the failing test for `createProject`**

Write `api/src/commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import type { Publisher } from './nats.js'
import type { Scene } from './events.js'
import { createCommandContext, createProject, type ScriptGenerator } from './commands.js'

function fakePublisher(): Publisher & { published: Array<{ subject: string; data: string; msgID?: string }> } {
  const published: Array<{ subject: string; data: string; msgID?: string }> = []
  return {
    published,
    async publish(subject, data, opts) {
      published.push({ subject, data, msgID: opts?.msgID })
      return undefined
    },
  }
}

const fixedScriptGen: ScriptGenerator = {
  async generateScenes(): Promise<{ scenes: Scene[] }> {
    return { scenes: [{ idx: 0, narration: 'a', visual: 'b' }] }
  },
}

describe('createProject', () => {
  it('appends ProjectCreated and publishes it', async () => {
    const store = createInMemoryEventStore()
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const { projectId } = await createProject(ctx, { idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(store.events).toHaveLength(1)
    expect(store.events[0]).toMatchObject({ type: 'ProjectCreated', projectId, idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(js.published).toHaveLength(1)
    expect(js.published[0]?.subject).toBe(`vidgen.evt.${projectId}.ProjectCreated`)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: FAIL — `Cannot find module './commands.js'`.

- [ ] **Step 4: Implement `commands.ts` scaffolding + `createProject`**

Write `api/src/commands.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Scene, VidgenEvent, ProjectState } from './events.js'
import { foldProject } from './events.js'
import { assertCanCreate, assertExists, assertTransition } from './aggregate.js'
import type { EventStore, Publisher } from './nats.js'
import { publishEvent, dispatchJob } from './nats.js'
import { admit, costCapFromEnv, projectedTtsUsd, CostCapExceededError } from './cost.js'

export type { EventStore } from './nats.js'

/** Authored fully in P2 (docs/superpowers/plans/2026-07-09-vidgen-webapp-02-agent-sdk-script.md).
 * P1 depends only on this interface and injects a stub for its own tests. */
export interface ScriptGenerator {
  generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string): Promise<{ scenes: Scene[] }>
}

export interface CreateProjectInput { idea: string; durationSec: number; sceneCount: number; tone: string }
export interface GenerateScriptInput { projectId: string }
export interface ResolveMaterialInput { projectId: string }
export interface GenerateVoiceoversInput { projectId: string }
export interface RequestApprovalInput { projectId: string }
export interface ApproveStoryboardInput { projectId: string }
export interface PublishInput { projectId: string; caption: string; privacy: string }

export interface CommandContext {
  store: EventStore
  js: Publisher
  scriptGen: ScriptGenerator
  now: () => string
  costCapUsd: number
}

export function createCommandContext(
  store: EventStore,
  js: Publisher,
  scriptGen: ScriptGenerator,
  costCapUsd: number = costCapFromEnv(),
): CommandContext {
  return { store, js, scriptGen, now: () => new Date().toISOString(), costCapUsd }
}

export async function createProject(ctx: CommandContext, input: CreateProjectInput): Promise<{ projectId: string }> {
  const projectId = randomUUID()
  const events = await ctx.store.loadEvents(projectId)
  assertCanCreate(events, projectId)
  const event: VidgenEvent = {
    v: 1,
    type: 'ProjectCreated',
    projectId,
    at: ctx.now(),
    idea: input.idea,
    durationSec: input.durationSec,
    sceneCount: input.sceneCount,
    tone: input.tone,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return { projectId }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add api/src/testutil/inMemoryEventStore.ts api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(api): command context + CreateProject handler"
```

---

## Task 11: `commands.ts` — `GenerateScript`

**Files:**
- Modify: `api/src/commands.ts`
- Modify: `api/src/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/src/commands.test.ts` (add `generateScript`, `InvalidTransitionError`, `ProjectNotFoundError` to the existing `commands.js`/`aggregate.js` imports):

```ts
import { generateScript } from './commands.js'
import { InvalidTransitionError, ProjectNotFoundError } from './aggregate.js'
```

```ts
describe('generateScript', () => {
  it('appends ScriptGenerated with scriptUsd forced to 0, regardless of what the generator reports', async () => {
    const store = createInMemoryEventStore([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'nước ấm', durationSec: 30, sceneCount: 1, tone: 'casual' },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await generateScript(ctx, { projectId: 'p1' })
    expect(state.status).toBe('scripted')
    expect(state.scenes).toEqual([{ idx: 0, narration: 'a', visual: 'b' }])
    const appended = store.events.at(-1)
    expect(appended).toMatchObject({ type: 'ScriptGenerated', scriptUsd: 0 })
  })

  it('rejects a project that does not exist', async () => {
    const store = createInMemoryEventStore()
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15)
    await expect(generateScript(ctx, { projectId: 'missing' })).rejects.toThrow(ProjectNotFoundError)
  })

  it('rejects a project that is already scripted', async () => {
    const store = createInMemoryEventStore([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 },
    ])
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15)
    await expect(generateScript(ctx, { projectId: 'p1' })).rejects.toThrow(InvalidTransitionError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: FAIL — `generateScript is not exported`.

- [ ] **Step 3: Implement `generateScript`**

Add to `api/src/commands.ts` (append at the end):

```ts
export async function generateScript(ctx: CommandContext, input: GenerateScriptInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('GenerateScript', state)
  const created = events.find((e): e is Extract<VidgenEvent, { type: 'ProjectCreated' }> => e.type === 'ProjectCreated')
  if (!created) throw new Error(`project ${input.projectId} missing ProjectCreated event`)
  const { scenes } = await ctx.scriptGen.generateScenes(created.idea, created.durationSec, created.sceneCount, created.tone)
  const event: VidgenEvent = {
    v: 1,
    type: 'ScriptGenerated',
    projectId: input.projectId,
    at: ctx.now(),
    scenes,
    scriptUsd: 0, // BINDING (index.md §6): Agent SDK notional cost is never enforced
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(api): GenerateScript handler — scriptUsd hard-pinned to 0"
```

---

## Task 12: `commands.ts` — `ResolveMaterial` and `GenerateVoiceovers`

**Files:**
- Modify: `api/src/commands.ts`
- Modify: `api/src/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/src/commands.test.ts` (extend the `commands.js` import with `resolveMaterial`, `generateVoiceovers`, and the `cost.js` import with `CostCapExceededError`):

```ts
import { resolveMaterial, generateVoiceovers } from './commands.js'
import { CostCapExceededError } from './cost.js'
```

```ts
const scriptedEvents = [
  { v: 1 as const, type: 'ProjectCreated' as const, projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 2, tone: 'casual' },
  {
    v: 1 as const,
    type: 'ScriptGenerated' as const,
    projectId: 'p1',
    at: 't1',
    scenes: [
      { idx: 0, narration: 'scene zero narration', visual: 'a' },
      { idx: 1, narration: 'scene one narration', visual: 'b' },
    ],
    scriptUsd: 0,
  },
]

describe('resolveMaterial', () => {
  it('dispatches one material job per scene and appends no event', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const before = store.events.length
    await resolveMaterial(ctx, { projectId: 'p1' })
    expect(store.events).toHaveLength(before)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.job.material.p1.0', 'vidgen.job.material.p1.1'])
  })
})

describe('generateVoiceovers', () => {
  it('appends CostProjected then dispatches tts and caption jobs when under the cap', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await generateVoiceovers(ctx, { projectId: 'p1' })
    expect(state.status).toBe('scripted') // CostProjected does not change status
    expect(store.events.at(-1)).toMatchObject({ type: 'CostProjected', capUsd: 0.15 })
    expect(js.published.map((m) => m.subject)).toEqual([
      'vidgen.evt.p1.CostProjected',
      'vidgen.job.tts.p1.0',
      'vidgen.job.tts.p1.1',
      'vidgen.job.caption.p1.0',
      'vidgen.job.caption.p1.1',
    ])
  })

  it('vetoes when projected cost exceeds the cap — no event, no jobs', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.00001) // cap far below 2 scenes of TTS
    await expect(generateVoiceovers(ctx, { projectId: 'p1' })).rejects.toThrow(CostCapExceededError)
    expect(store.events).toHaveLength(scriptedEvents.length)
    expect(js.published).toHaveLength(0)
  })
})
```

Note: `resolveMaterial`/`generateVoiceovers` are legal from `'material'` per `aggregate.ts`, but these tests run them straight from `'scripted'` state — that's intentional here to isolate dispatch behavior before Task 13 wires the full transition chain; **fix this now**: reread `LEGAL_FROM` — `ResolveMaterial` is legal from `'scripted'` (correct, matches the test above) but `GenerateVoiceovers` is legal from `'material'`, so the second `describe` block's precondition is wrong as written. Use scenes with a `MaterialResolved` fold instead:

```ts
const materialEvents = [
  ...scriptedEvents,
  { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't2', sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' },
  { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't3', sceneIdx: 1, source: 'pexels', assetPath: '/m/1.mp4' },
]
```

Replace `scriptedEvents` with `materialEvents` in both `generateVoiceovers` tests above, and change the first assertion to `expect(state.status).toBe('material')`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: FAIL — `resolveMaterial is not exported`.

- [ ] **Step 3: Implement `resolveMaterial` and `generateVoiceovers`**

Add to `api/src/commands.ts` (append at the end):

```ts
export async function resolveMaterial(ctx: CommandContext, input: ResolveMaterialInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ResolveMaterial', state)
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'material', input.projectId, scene.idx, { narration: scene.narration, visual: scene.visual })
  }
  return state
}

export async function generateVoiceovers(ctx: CommandContext, input: GenerateVoiceoversInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('GenerateVoiceovers', state)
  const additionalUsd = projectedTtsUsd(state.scenes)
  const result = admit(state, additionalUsd, ctx.costCapUsd)
  if (!result.admitted) {
    throw new CostCapExceededError(result.projectedUsd, result.capUsd)
  }
  const event: VidgenEvent = {
    v: 1,
    type: 'CostProjected',
    projectId: input.projectId,
    at: ctx.now(),
    projectedUsd: result.projectedUsd,
    capUsd: result.capUsd,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'tts', input.projectId, scene.idx, { narration: scene.narration })
  }
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'caption', input.projectId, scene.idx, {})
  }
  return foldProject([...events, event])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(api): ResolveMaterial + GenerateVoiceovers (cost-wall admissibility)"
```

---

## Task 13: `commands.ts` — `RequestApproval` and `ApproveStoryboard`

**Files:**
- Modify: `api/src/commands.ts`
- Modify: `api/src/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/src/commands.test.ts` (extend the `commands.js` import with `requestApproval`, `approveStoryboard`):

```ts
import { requestApproval, approveStoryboard } from './commands.js'
```

```ts
describe('requestApproval', () => {
  it('appends AwaitingApproval', async () => {
    const store = createInMemoryEventStore(materialEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await requestApproval(ctx, { projectId: 'p1' })
    expect(state.status).toBe('awaiting_approval')
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.evt.p1.AwaitingApproval'])
  })
})

describe('approveStoryboard', () => {
  it('appends ApprovalGranted and dispatches a render job', async () => {
    const events = [...materialEvents, { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't4' }]
    const store = createInMemoryEventStore(events)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await approveStoryboard(ctx, { projectId: 'p1' })
    expect(state.status).toBe('approved')
    expect(state.approved).toBe(true)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.evt.p1.ApprovalGranted', 'vidgen.job.render.p1.-'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: FAIL — `requestApproval is not exported`.

- [ ] **Step 3: Implement `requestApproval` and `approveStoryboard`**

Add to `api/src/commands.ts` (append at the end):

```ts
export async function requestApproval(ctx: CommandContext, input: RequestApprovalInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('RequestApproval', state)
  const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId: input.projectId, at: ctx.now() }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function approveStoryboard(ctx: CommandContext, input: ApproveStoryboardInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ApproveStoryboard', state)
  const event: VidgenEvent = { v: 1, type: 'ApprovalGranted', projectId: input.projectId, at: ctx.now() }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  await dispatchJob(ctx.js, 'render', input.projectId, null, {})
  return foldProject([...events, event])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(api): RequestApproval + ApproveStoryboard handlers"
```

---

## Task 14: `commands.ts` — `Publish`

**Files:**
- Modify: `api/src/commands.ts`
- Modify: `api/src/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `api/src/commands.test.ts` (extend the `commands.js` import with `publish`):

```ts
import { publish } from './commands.js'
```

```ts
describe('publish', () => {
  it('appends Published from a rendered project', async () => {
    const events = [
      ...materialEvents,
      { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't4' },
      { v: 1 as const, type: 'ApprovalGranted' as const, projectId: 'p1', at: 't5' },
      { v: 1 as const, type: 'RenderCompleted' as const, projectId: 'p1', at: 't6', outputPath: '/m/p1.mp4', renderUsd: 0 },
    ]
    const store = createInMemoryEventStore(events)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await publish(ctx, { projectId: 'p1', caption: 'hello', privacy: 'public' })
    expect(state.status).toBe('published')
    const appended = store.events.at(-1)
    expect(appended).toMatchObject({ type: 'Published', platform: 'public' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: FAIL — `publish is not exported`.

- [ ] **Step 3: Implement `publish`**

Add to `api/src/commands.ts` (append at the end):

```ts
export async function publish(ctx: CommandContext, input: PublishInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('Publish', state)
  // P1 stub: the real TikTok publish call is a Go worker concern (P3), not
  // yet built. index.md §5 freezes this command as appending Published
  // directly (no job dispatch), so we synthesize a deterministic result
  // from the command body until P3's publish result event replaces this.
  const postId = randomUUID()
  const event: VidgenEvent = {
    v: 1,
    type: 'Published',
    projectId: input.projectId,
    at: ctx.now(),
    platform: input.privacy,
    postId,
    url: `https://vidgen.local/p/${postId}`,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/commands.test.ts`
Expected: PASS — 10 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(api): Publish handler (P1 stub result — see comment for P3 follow-up)"
```

---

## Task 15: `script.ts` — P1 stub `ScriptGenerator`

**Files:**
- Create: `api/src/script.ts`
- Test: `api/src/script.test.ts`

- [ ] **Step 1: Write the failing test**

Write `api/src/script.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stubScriptGenerator } from './script.js'

describe('stubScriptGenerator', () => {
  it('returns exactly sceneCount scenes with sequential idx starting at 0', async () => {
    const { scenes } = await stubScriptGenerator.generateScenes('nước ấm', 30, 3, 'casual')
    expect(scenes.map((s) => s.idx)).toEqual([0, 1, 2])
    for (const scene of scenes) {
      expect(scene.narration.length).toBeGreaterThan(0)
      expect(scene.visual.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/script.test.ts`
Expected: FAIL — `Cannot find module './script.js'`.

- [ ] **Step 3: Implement the stub**

Write `api/src/script.ts`:

```ts
import type { Scene } from './events.js'
import type { ScriptGenerator } from './commands.js'

// P1 placeholder ScriptGenerator. The real Claude Agent SDK integration is
// built in docs/superpowers/plans/2026-07-09-vidgen-webapp-02-agent-sdk-script.md
// (P2) and overwrites this file's export in index.ts's wiring. Kept in its
// own file (not commands.ts) so P2 can replace it without touching P1 code.
export const stubScriptGenerator: ScriptGenerator = {
  async generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string): Promise<{ scenes: Scene[] }> {
    const perSceneSec = Math.max(1, Math.round(durationSec / sceneCount))
    const scenes: Scene[] = Array.from({ length: sceneCount }, (_, idx) => ({
      idx,
      narration: `[${tone}] ${idea} — scene ${idx + 1} of ${sceneCount} (${perSceneSec}s)`,
      visual: `stock footage matching "${idea}"`,
    }))
    return { scenes }
  },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/script.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/script.ts api/src/script.test.ts
git commit -m "feat(api): P1 stub ScriptGenerator (replaced by Agent SDK in P2)"
```

---

## Task 16: `projections.ts` — `applyProjection` for `ProjectCreated`/`ScriptGenerated`

**Files:**
- Create: `api/src/projections.ts`
- Test: `api/src/projections.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Write `api/src/projections.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection } from './projections.js'
import type { VidgenEvent } from './events.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

describe('applyProjection (integration)', () => {
  let db: Database
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
      await migrate(db)
    } catch {
      reachable = false
    }
  })

  afterAll(async () => {
    await db.end()
  })

  beforeEach(async () => {
    if (reachable) await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
  })

  it('ProjectCreated inserts a draft project row', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    const event: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    await applyProjection(db, event)
    const result = await db.query('SELECT project_id, idea, status FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows).toEqual([{ project_id: 'p1', idea: 'x', status: 'draft' }])
  })

  it('ScriptGenerated sets status to scripted and inserts scene rows', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 2, tone: 'casual' })
    await applyProjection(db, {
      v: 1,
      type: 'ScriptGenerated',
      projectId: 'p1',
      at: 't1',
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

  it('re-applying the same events is idempotent (upsert, not duplicate rows)', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    await applyProjection(db, created)
    await applyProjection(db, created)
    const result = await db.query('SELECT count(*)::int AS n FROM projects WHERE project_id = $1', ['p1'])
    expect(result.rows[0]).toEqual({ n: 1 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/projections.integration.test.ts`
Expected: FAIL — `Cannot find module './projections.js'`.

- [ ] **Step 3: Implement `applyProjection` for these two event types**

Write `api/src/projections.ts`:

```ts
import type { VidgenEvent } from './events.js'
import type { Database } from './db.js'

export const PROJECTIONS_CONSUMER = 'projections'

export async function applyProjection(db: Database, event: VidgenEvent): Promise<void> {
  switch (event.type) {
    case 'ProjectCreated':
      await db.query(
        `INSERT INTO projects (project_id, idea, duration_sec, scene_count, tone, status, spent_usd, approved, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', 0, FALSE, $6, $6)
         ON CONFLICT (project_id) DO UPDATE SET
           idea = EXCLUDED.idea, duration_sec = EXCLUDED.duration_sec,
           scene_count = EXCLUDED.scene_count, tone = EXCLUDED.tone, updated_at = EXCLUDED.updated_at`,
        [event.projectId, event.idea, event.durationSec, event.sceneCount, event.tone, event.at],
      )
      break
    case 'ScriptGenerated':
      await db.query(`UPDATE projects SET status = 'scripted', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      for (const scene of event.scenes) {
        await db.query(
          `INSERT INTO scenes (project_id, idx, narration, visual)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, idx) DO UPDATE SET narration = EXCLUDED.narration, visual = EXCLUDED.visual`,
          [event.projectId, scene.idx, scene.narration, scene.visual],
        )
      }
      break
    default:
      break // remaining event types handled in Tasks 17–18
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/projections.integration.test.ts`
Expected: PASS — 3 tests passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/projections.ts api/src/projections.integration.test.ts
git commit -m "feat(api): projections — ProjectCreated + ScriptGenerated folds (idempotent upsert)"
```

---

## Task 17: `projections.ts` — `applyProjection` for `MaterialResolved`/`VoiceSynthesized`/`CaptionsBuilt`/`CostProjected`

**Files:**
- Modify: `api/src/projections.ts`
- Modify: `api/src/projections.integration.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `api/src/projections.integration.test.ts`:

```ts
it('MaterialResolved sets status to material and records a material asset', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
  await applyProjection(db, { v: 1, type: 'MaterialResolved', projectId: 'p1', at: 't2', sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' })
  const project = await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])
  expect(project.rows[0]).toEqual({ status: 'material' })
  const asset = await db.query('SELECT kind, path FROM assets WHERE project_id = $1', ['p1'])
  expect(asset.rows).toEqual([{ kind: 'material', path: '/m/0.mp4' }])
})

it('VoiceSynthesized records a voice asset, a ledger row, and recomputes spent_usd', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
  await applyProjection(db, { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: 't2', sceneIdx: 0, mp3Path: '/m/0.mp3', ttsUsd: 0.0007 })
  const project = await db.query('SELECT spent_usd FROM projects WHERE project_id = $1', ['p1'])
  expect(Number(project.rows[0].spent_usd)).toBeCloseTo(0.0007)
  const ledger = await db.query('SELECT event_type, amount_usd FROM cost_ledger WHERE project_id = $1', ['p1'])
  expect(ledger.rows).toEqual([{ event_type: 'VoiceSynthesized', amount_usd: '0.0007' }])
})

it('CaptionsBuilt records an ass_path on the scene and a caption asset', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })
  await applyProjection(db, { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: 't2', sceneIdx: 0, assPath: '/m/0.ass' })
  const scene = await db.query('SELECT ass_path FROM scenes WHERE project_id = $1 AND idx = 0', ['p1'])
  expect(scene.rows[0]).toEqual({ ass_path: '/m/0.ass' })
})

it('CostProjected does not error and does not add to the ledger (observability only)', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'CostProjected', projectId: 'p1', at: 't1', projectedUsd: 0.01, capUsd: 0.15 })
  const ledger = await db.query('SELECT count(*)::int AS n FROM cost_ledger WHERE project_id = $1', ['p1'])
  expect(ledger.rows[0]).toEqual({ n: 0 })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/projections.integration.test.ts`
Expected: FAIL — `MaterialResolved sets status to material...` fails because `status` stays `'scripted'` (falls into the `default: break` branch).

- [ ] **Step 3: Implement the four handlers + `recomputeSpentUsd`**

Replace the `default: break` line in `api/src/projections.ts` with:

```ts
    case 'MaterialResolved':
      await db.query(`UPDATE projects SET status = 'material', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      await db.query(
        `UPDATE scenes SET material_source = $3, material_path = $4 WHERE project_id = $1 AND idx = $2`,
        [event.projectId, event.sceneIdx, event.source, event.assetPath],
      )
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'material', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.assetPath, event.at],
      )
      break
    case 'VoiceSynthesized':
      await db.query(`UPDATE scenes SET mp3_path = $3, tts_usd = $4 WHERE project_id = $1 AND idx = $2`, [
        event.projectId, event.sceneIdx, event.mp3Path, event.ttsUsd,
      ])
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'voice', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.mp3Path, event.at],
      )
      await db.query(
        `INSERT INTO cost_ledger (project_id, event_type, scene_idx, amount_usd, at)
         VALUES ($1, 'VoiceSynthesized', $2, $3, $4)
         ON CONFLICT (project_id, event_type, (COALESCE(scene_idx, -1)))
         DO UPDATE SET amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at`,
        [event.projectId, event.sceneIdx, event.ttsUsd, event.at],
      )
      await recomputeSpentUsd(db, event.projectId)
      break
    case 'CaptionsBuilt':
      await db.query(`UPDATE scenes SET ass_path = $3 WHERE project_id = $1 AND idx = $2`, [event.projectId, event.sceneIdx, event.assPath])
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'caption', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.assPath, event.at],
      )
      break
    case 'CostProjected':
      // Observability only — projected cost is not part of the enforced
      // ledger total (index.md §6: enforced total = Σ ttsUsd + renderUsd).
      break
    default:
      break // remaining event types handled in Task 18
```

Add this helper function at the end of `api/src/projections.ts`:

```ts
async function recomputeSpentUsd(db: Database, projectId: string): Promise<void> {
  await db.query(
    `UPDATE projects SET spent_usd = COALESCE((SELECT SUM(amount_usd) FROM cost_ledger WHERE project_id = $1), 0) WHERE project_id = $1`,
    [projectId],
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/projections.integration.test.ts`
Expected: PASS — 7 tests passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/projections.ts api/src/projections.integration.test.ts
git commit -m "feat(api): projections — material/voice/caption/cost-projected folds"
```

---

## Task 18: `projections.ts` — remaining event types + `runProjections`/`rebuildProjections`

**Files:**
- Modify: `api/src/projections.ts`
- Modify: `api/src/projections.integration.test.ts`
- Modify: `api/src/nats.integration.test.ts` (rebuild test needs a live bus too, but lives in `projections.integration.test.ts` per Step 3 below)

- [ ] **Step 1: Write the failing tests**

Append to `api/src/projections.integration.test.ts`:

```ts
it('AwaitingApproval / ApprovalGranted / RenderCompleted / Published / RunFailed drive status forward', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't1' })
  expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'awaiting_approval' })

  await applyProjection(db, { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: 't2' })
  let row = (await db.query('SELECT status, approved FROM projects WHERE project_id = $1', ['p1'])).rows[0]
  expect(row).toEqual({ status: 'approved', approved: true })

  await applyProjection(db, { v: 1, type: 'RenderCompleted', projectId: 'p1', at: 't3', outputPath: '/m/p1.mp4', renderUsd: 0 })
  row = (await db.query('SELECT status, output_path FROM projects WHERE project_id = $1', ['p1'])).rows[0]
  expect(row).toEqual({ status: 'rendered', output_path: '/m/p1.mp4' })
  const asset = await db.query(`SELECT kind, path FROM assets WHERE project_id = $1 AND kind = 'render'`, ['p1'])
  expect(asset.rows).toEqual([{ kind: 'render', path: '/m/p1.mp4' }])

  await applyProjection(db, { v: 1, type: 'Published', projectId: 'p1', at: 't4', platform: 'tiktok', postId: 'abc', url: 'https://x/abc' })
  expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'published' })
})

it('RunFailed sets status to failed', async (ctx) => {
  ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
  await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
  await applyProjection(db, { v: 1, type: 'RunFailed', projectId: 'p1', at: 't1', stage: 'render', error: 'ffmpeg exit 1' })
  expect((await db.query('SELECT status FROM projects WHERE project_id = $1', ['p1'])).rows[0]).toEqual({ status: 'failed' })
})
```

Append a second `describe` block for the rebuild property, using a live NATS bus:

```ts
describe('rebuildProjections (integration)', () => {
  it('TRUNCATE + replay from stream seq 0 fully reconstructs the read model', async (ctx) => {
    const natsUrl = process.env.NATS_URL ?? 'nats://localhost:4223'
    let bus
    try {
      bus = await connectBus(natsUrl)
    } catch {
      bus = null
    }
    ctx.skip(!reachable || bus === null, 'needs both local Postgres and local NATS')
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = `p-${Date.now()}`
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId, at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId, at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }
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
```

Add these imports at the top of `api/src/projections.integration.test.ts`:

```ts
import { connectBus, ensureStreams, publishEvent } from './nats.js'
import { rebuildProjections } from './projections.js'
```

(`applyProjection` import stays; add `rebuildProjections` alongside it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/projections.integration.test.ts`
Expected: FAIL — first new test fails (status stays `'scripted'`, never reaches `'awaiting_approval'`); `rebuildProjections is not exported`.

- [ ] **Step 3: Implement the remaining `applyProjection` cases and the runner functions**

Replace the `default: break` line (now the last case) in `api/src/projections.ts` with:

```ts
    case 'AwaitingApproval':
      await db.query(`UPDATE projects SET status = 'awaiting_approval', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'ApprovalGranted':
      await db.query(`UPDATE projects SET status = 'approved', approved = TRUE, updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'RenderCompleted':
      await db.query(
        `UPDATE projects SET status = 'rendered', output_path = $2, updated_at = $3 WHERE project_id = $1`,
        [event.projectId, event.outputPath, event.at],
      )
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, NULL, 'render', $2, $3)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.outputPath, event.at],
      )
      await db.query(
        `INSERT INTO cost_ledger (project_id, event_type, scene_idx, amount_usd, at)
         VALUES ($1, 'RenderCompleted', NULL, $2, $3)
         ON CONFLICT (project_id, event_type, (COALESCE(scene_idx, -1)))
         DO UPDATE SET amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at`,
        [event.projectId, event.renderUsd, event.at],
      )
      await recomputeSpentUsd(db, event.projectId)
      break
    case 'Published':
      await db.query(`UPDATE projects SET status = 'published', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'RunFailed':
      await db.query(`UPDATE projects SET status = 'failed', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
```

Add the imports and runner functions at the end of `api/src/projections.ts` (extend the existing `./nats.js` import — there isn't one yet in this file, so add a new import line):

```ts
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream'
import { EVENTS_STREAM, ensureDurableConsumer, deleteDurableConsumer, consumeEvents } from './nats.js'
```

```ts
/** Long-running: wires the durable "projections" consumer to fold every new
 * VIDGEN_EVENTS message into Postgres. Backlog is delivered first (durable
 * consumers with DeliverPolicy.All start at the beginning on first
 * creation), then live events as they arrive. Never resolves in normal
 * operation — callers run it as a background task. */
export async function runProjections(js: JetStreamClient, jsm: JetStreamManager, db: Database): Promise<void> {
  await ensureDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  await consumeEvents(js, PROJECTIONS_CONSUMER, (event) => applyProjection(db, event))
}

/** Postgres is disposable (spec §2.5): wipe the read-model tables, drop the
 * durable consumer's ack floor by deleting and recreating it, then
 * synchronously fetch every stored event from stream seq 0 and re-fold it.
 * Bounded (returns once a fetch comes back empty), unlike runProjections. */
export async function rebuildProjections(js: JetStreamClient, jsm: JetStreamManager, db: Database): Promise<void> {
  await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
  await deleteDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  await ensureDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  const consumer = await js.consumers.get(EVENTS_STREAM, PROJECTIONS_CONSUMER)
  for (;;) {
    const batch = await consumer.fetch({ max_messages: 1000, expires: 500 })
    let count = 0
    for await (const m of batch) {
      const event = m.json<VidgenEvent>()
      await applyProjection(db, event)
      m.ack()
      count++
    }
    if (count === 0) break
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose up -d nats` (if not already running) then `cd api && npx vitest run src/projections.integration.test.ts`
Expected: PASS — 10 tests passed (not skipped).

- [ ] **Step 5: Commit**

```bash
git add api/src/projections.ts api/src/projections.integration.test.ts
git commit -m "feat(api): projections — remaining event folds + runProjections/rebuildProjections"
```

---

## Task 19: `http.ts` — request parsing + GET endpoints

**Files:**
- Create: `api/src/http.ts`
- Test: `api/src/http.test.ts`
- Test: `api/src/http.integration.test.ts`

- [ ] **Step 1: Write the failing unit tests for the pure body parsers**

Write `api/src/http.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HttpError, requireProjectId, parseCreateProjectInput, parsePublishInput } from './http.js'

describe('requireProjectId', () => {
  it('returns projectId when present', () => {
    expect(requireProjectId({ projectId: 'p1' })).toBe('p1')
  })

  it('throws HttpError(400) when missing', () => {
    expect(() => requireProjectId({})).toThrow(HttpError)
  })
})

describe('parseCreateProjectInput', () => {
  it('parses a valid body', () => {
    const input = parseCreateProjectInput({ idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(input).toEqual({ idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' })
  })

  it('rejects a body missing durationSec', () => {
    expect(() => parseCreateProjectInput({ idea: 'x', sceneCount: 3, tone: 'casual' })).toThrow(HttpError)
  })
})

describe('parsePublishInput', () => {
  it('parses a valid body', () => {
    const input = parsePublishInput({ projectId: 'p1', caption: 'hi', privacy: 'public' })
    expect(input).toEqual({ projectId: 'p1', caption: 'hi', privacy: 'public' })
  })

  it('rejects a body missing caption', () => {
    expect(() => parsePublishInput({ projectId: 'p1', privacy: 'public' })).toThrow(HttpError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/http.test.ts`
Expected: FAIL — `Cannot find module './http.js'`.

- [ ] **Step 3: Implement the parsers, `HttpError`, and the two GET read functions**

Write `api/src/http.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './db.js'
import type { CommandContext, CreateProjectInput, PublishInput } from './commands.js'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireProjectId(body: Record<string, unknown>): string {
  if (typeof body.projectId !== 'string' || body.projectId.length === 0) {
    throw new HttpError(400, 'projectId:string is required')
  }
  return body.projectId
}

export function parseCreateProjectInput(body: Record<string, unknown>): CreateProjectInput {
  const { idea, durationSec, sceneCount, tone } = body
  if (typeof idea !== 'string' || typeof durationSec !== 'number' || typeof sceneCount !== 'number' || typeof tone !== 'string') {
    throw new HttpError(400, 'CreateProject requires idea:string, durationSec:number, sceneCount:number, tone:string')
  }
  return { idea, durationSec, sceneCount, tone }
}

export function parsePublishInput(body: Record<string, unknown>): PublishInput {
  const projectId = requireProjectId(body)
  const { caption, privacy } = body
  if (typeof caption !== 'string' || typeof privacy !== 'string') {
    throw new HttpError(400, 'Publish requires caption:string, privacy:string')
  }
  return { projectId, caption, privacy }
}

export interface ProjectSummary {
  projectId: string
  idea: string
  status: string
  spentUsd: number
  approved: boolean
  outputPath: string | null
}

export async function listProjects(db: Database): Promise<ProjectSummary[]> {
  const result = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path FROM projects ORDER BY created_at DESC')
  return result.rows.map((row) => ({
    projectId: row.project_id,
    idea: row.idea,
    status: row.status,
    spentUsd: Number(row.spent_usd),
    approved: row.approved,
    outputPath: row.output_path,
  }))
}

export interface ProjectDetail extends ProjectSummary {
  scenes: Array<{ idx: number; narration: string; visual: string; materialPath: string | null; mp3Path: string | null; assPath: string | null }>
}

export async function getProject(db: Database, projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path FROM projects WHERE project_id = $1', [projectId])
  const row = projectResult.rows[0]
  if (!row) return null
  const sceneResult = await db.query<{
    idx: number; narration: string; visual: string; material_path: string | null; mp3_path: string | null; ass_path: string | null
  }>('SELECT idx, narration, visual, material_path, mp3_path, ass_path FROM scenes WHERE project_id = $1 ORDER BY idx ASC', [projectId])
  return {
    projectId: row.project_id,
    idea: row.idea,
    status: row.status,
    spentUsd: Number(row.spent_usd),
    approved: row.approved,
    outputPath: row.output_path,
    scenes: sceneResult.rows.map((s) => ({
      idx: s.idx,
      narration: s.narration,
      visual: s.visual,
      materialPath: s.material_path,
      mp3Path: s.mp3_path,
      assPath: s.ass_path,
    })),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/http.test.ts`
Expected: PASS — 6 tests passed.

- [ ] **Step 5: Write and run an integration test for the two GET reads against real Postgres**

Write `api/src/http.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, migrate, type Database } from './db.js'
import { applyProjection } from './projections.js'
import { listProjects, getProject } from './http.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'

describe('listProjects + getProject (integration)', () => {
  let db: Database
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
      await migrate(db)
      await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
    } catch {
      reachable = false
    }
  })

  afterAll(async () => {
    await db.end()
  })

  it('lists created projects and fetches one by id with its scenes', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')
    await applyProjection(db, { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' })
    await applyProjection(db, { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 })

    const all = await listProjects(db)
    expect(all).toEqual([{ projectId: 'p1', idea: 'x', status: 'scripted', spentUsd: 0, approved: false, outputPath: null }])

    const one = await getProject(db, 'p1')
    expect(one?.scenes).toEqual([{ idx: 0, narration: 'a', visual: 'b', materialPath: null, mp3Path: null, assPath: null }])

    expect(await getProject(db, 'missing')).toBeNull()
  })
})
```

Run: `cd api && npx vitest run src/http.integration.test.ts`
Expected: PASS — 1 test passed (not skipped).

- [ ] **Step 6: Commit**

```bash
git add api/src/http.ts api/src/http.test.ts api/src/http.integration.test.ts
git commit -m "feat(api): http request parsers + listProjects/getProject baseline reads"
```

---

## Task 20: `http.ts` — command routing, idempotency, static + media serving

**Files:**
- Modify: `api/src/http.ts`
- Modify: `api/src/http.integration.test.ts`

- [ ] **Step 1: Write the failing end-to-end HTTP test**

Append to `api/src/http.integration.test.ts` (add these imports at the top, alongside the existing ones):

```ts
import { createHttpServer } from './http.js'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import { createCommandContext } from './commands.js'
import type { ScriptGenerator } from './commands.js'
import type { Scene } from './events.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
```

```ts
describe('createHttpServer (integration)', () => {
  let db: Database
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
      await migrate(db)
      await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
    } catch {
      reachable = false
    }
  })

  afterAll(async () => {
    await db.end()
  })

  it('serves POST /api/commands/CreateProject, GET /api/state, static SPA, and /media/*', async (ctx) => {
    ctx.skip(!reachable, 'no local Postgres at DATABASE_URL')

    const spaDir = mkdtempSync(path.join(tmpdir(), 'vidgen-spa-'))
    writeFileSync(path.join(spaDir, 'index.html'), '<html><body>vidgen</body></html>')
    const mediaDir = mkdtempSync(path.join(tmpdir(), 'vidgen-media-'))
    writeFileSync(path.join(mediaDir, 'clip.mp4'), 'fake-mp4-bytes')

    const store = createInMemoryEventStore()
    const fixedScriptGen: ScriptGenerator = { async generateScenes(): Promise<{ scenes: Scene[] }> { return { scenes: [] } } }
    const js = { async publish(): Promise<undefined> { return undefined } }
    const ctxCmd = createCommandContext(store, js, fixedScriptGen, 0.15)
    const server = createHttpServer({ db, ctx: ctxCmd, spaDir, mediaDir })
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

    const spaRes = await fetch(`${base}/`)
    expect(spaRes.status).toBe(200)
    expect(await spaRes.text()).toContain('vidgen')

    const mediaRes = await fetch(`${base}/media/clip.mp4`)
    expect(mediaRes.status).toBe(200)
    expect(await mediaRes.text()).toBe('fake-mp4-bytes')

    const unknownCommandRes = await fetch(`${base}/api/commands/NotACommand`, { method: 'POST', body: '{}' })
    expect(unknownCommandRes.status).toBe(404)

    server.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run src/http.integration.test.ts`
Expected: FAIL — `createHttpServer is not exported`.

- [ ] **Step 3: Implement command routing, idempotency cache, static/media serving**

Add to `api/src/http.ts` (append at the end; extend the existing `./commands.js` import to include all seven input/handler names):

```ts
import type {
  ResolveMaterialInput, GenerateVoiceoversInput, RequestApprovalInput, ApproveStoryboardInput, GenerateScriptInput,
} from './commands.js'
import * as commands from './commands.js'

export interface HttpConfig {
  db: Database
  ctx: CommandContext
  spaDir: string
  mediaDir: string
}

type CommandHandler = (ctx: CommandContext, body: Record<string, unknown>) => Promise<unknown>

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  CreateProject: (ctx, body) => commands.createProject(ctx, parseCreateProjectInput(body)),
  GenerateScript: (ctx, body) => commands.generateScript(ctx, { projectId: requireProjectId(body) } satisfies GenerateScriptInput),
  ResolveMaterial: (ctx, body) => commands.resolveMaterial(ctx, { projectId: requireProjectId(body) } satisfies ResolveMaterialInput),
  GenerateVoiceovers: (ctx, body) => commands.generateVoiceovers(ctx, { projectId: requireProjectId(body) } satisfies GenerateVoiceoversInput),
  RequestApproval: (ctx, body) => commands.requestApproval(ctx, { projectId: requireProjectId(body) } satisfies RequestApprovalInput),
  ApproveStoryboard: (ctx, body) => commands.approveStoryboard(ctx, { projectId: requireProjectId(body) } satisfies ApproveStoryboardInput),
  Publish: (ctx, body) => commands.publish(ctx, parsePublishInput(body)),
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'request body must be a JSON object')
  }
  return parsed
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Best-effort, per-process cache: guards against re-running a command
 * handler for a retried idempotencyKey within one api process's lifetime.
 * True cross-restart dedup comes from the NATS 2-minute dupe window on the
 * deterministic event msgID (index.md §4) — this cache just avoids paying
 * for (e.g.) a second script-generation call on a client retry. */
const idempotencyCache = new Map<string, unknown>()

async function handleCommand(config: HttpConfig, name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const handler = COMMAND_HANDLERS[name]
  if (!handler) {
    sendJson(res, 404, { error: `unknown command ${name}` })
    return
  }
  const body = await readJsonBody(req)
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
  const cacheKey = idempotencyKey ? `${name}:${idempotencyKey}` : undefined
  if (cacheKey && idempotencyCache.has(cacheKey)) {
    sendJson(res, 200, idempotencyCache.get(cacheKey))
    return
  }
  const result = await handler(config.ctx, body)
  if (cacheKey) idempotencyCache.set(cacheKey, result)
  sendJson(res, 200, result)
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
}

async function serveStatic(rootDir: string, urlPath: string, res: ServerResponse, fallbackToIndex: boolean): Promise<void> {
  const safeSuffix = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(rootDir, safeSuffix)
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
    await stat(filePath)
  } catch {
    if (!fallbackToIndex) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    filePath = path.join(rootDir, 'index.html')
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

async function routeRequest(config: HttpConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/api/commands/')) {
      await handleCommand(config, url.pathname.slice('/api/commands/'.length), req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, { projects: await listProjects(config.db) })
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
      const projectId = url.pathname.slice('/api/projects/'.length)
      const project = await getProject(config.db, projectId)
      if (!project) {
        sendJson(res, 404, { error: `project ${projectId} not found` })
        return
      }
      sendJson(res, 200, project)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      await serveStatic(config.mediaDir, url.pathname.slice('/media/'.length), res, false)
      return
    }
    if (req.method === 'GET') {
      await serveStatic(config.spaDir, url.pathname, res, true)
      return
    }
    sendJson(res, 405, { error: 'method not allowed' })
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
      return
    }
    console.error('http handler error:', err)
    sendJson(res, 500, { error: 'internal error' })
  }
}

export function createHttpServer(config: HttpConfig) {
  return createServer((req, res) => {
    void routeRequest(config, req, res)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run src/http.integration.test.ts`
Expected: PASS — 2 tests passed (not skipped).

- [ ] **Step 5: Run the full unit + integration suite**

Run: `cd api && npx vitest run`
Expected: PASS — all test files pass (integration ones skipped only if NATS/Postgres from the "Local dev prerequisites" section aren't running).

- [ ] **Step 6: Commit**

```bash
git add api/src/http.ts api/src/http.integration.test.ts
git commit -m "feat(api): POST /api/commands/*, idempotency cache, static SPA + /media/* serving"
```

---

## Task 21: `index.ts` bootstrap, `api/Dockerfile`, extend `docker-compose.yml`

**Files:**
- Create: `api/src/index.ts`
- Create: `api/Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write `index.ts`**

Write `api/src/index.ts`:

```ts
import { createPool, migrate } from './db.js'
import { connectBus, ensureStreams, createEventStore } from './nats.js'
import { createCommandContext } from './commands.js'
import { runProjections } from './projections.js'
import { createHttpServer } from './http.js'
import { stubScriptGenerator } from './script.js'
import { costCapFromEnv } from './cost.js'

async function main(): Promise<void> {
  const natsServers = process.env.NATS_URL ?? 'nats://localhost:4223'
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'
  const port = Number(process.env.PORT ?? 8080)
  const spaDir = process.env.SPA_DIR ?? 'public'
  const mediaDir = process.env.MEDIA_DIR ?? 'media'

  const db = createPool(databaseUrl)
  await migrate(db)

  const bus = await connectBus(natsServers)
  await ensureStreams(bus.jsm)

  const store = createEventStore(bus.js)
  const ctx = createCommandContext(store, bus.js, stubScriptGenerator, costCapFromEnv())

  runProjections(bus.js, bus.jsm, db).catch((err: unknown) => {
    console.error('projections consumer stopped:', err)
    process.exit(1)
  })

  const server = createHttpServer({ db, ctx, spaDir, mediaDir })
  server.listen(port, () => {
    console.log(`api listening on :${port}`)
  })
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Verify it builds**

Run: `cd api && npx tsc -p tsconfig.json --noEmit`
Expected: exits 0, no type errors printed.

- [ ] **Step 3: Write `api/Dockerfile`**

Write `api/Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Extend `docker-compose.yml` with `postgres` and `api`, without touching the existing `nats` service**

Read the current `docker-compose.yml` (reproduced here from the repo root so the diff is unambiguous):

```yaml
services:
  nats:
    image: nats:2.10-alpine
    command: ["-c", "/etc/nats/nats.conf"]
    ports:
      - "4223:4222"   # TCP: api + worker (host 4223 — 4222 taken by another project's nats)
      - "8081:8080"   # WebSocket: browser (nats.ws) (host 8081)
      - "8223:8222"   # monitoring (host 8223)
    volumes:
      - ./deploy/nats/nats.conf:/etc/nats/nats.conf:ro
      - nats-data:/data

volumes:
  nats-data:
```

Replace the whole file with:

```yaml
services:
  nats:
    image: nats:2.10-alpine
    command: ["-c", "/etc/nats/nats.conf"]
    ports:
      - "4223:4222"   # TCP: api + worker (host 4223 — 4222 taken by another project's nats)
      - "8081:8080"   # WebSocket: browser (nats.ws) (host 8081)
      - "8223:8222"   # monitoring (host 8223)
    volumes:
      - ./deploy/nats/nats.conf:/etc/nats/nats.conf:ro
      - nats-data:/data

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vidgen
      POSTGRES_PASSWORD: vidgen
      POSTGRES_DB: vidgen
    ports:
      - "5433:5432"   # host 5433 — matches api/src's local-dev default DATABASE_URL
    volumes:
      - postgres-data:/var/lib/postgresql/data

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    depends_on:
      - nats
      - postgres
    environment:
      NATS_URL: nats://nats:4222
      DATABASE_URL: postgres://vidgen:vidgen@postgres:5432/vidgen
      COST_CAP_USD: "0.15"
      PORT: "8080"
      SPA_DIR: /app/public
      MEDIA_DIR: /app/media
    ports:
      - "8080:8080"
    volumes:
      - media-data:/app/media

volumes:
  nats-data:
  postgres-data:
  media-data:
```

- [ ] **Step 5: Verify the compose file is valid and the api image builds**

Run: `docker compose config --quiet`
Expected: exits 0, no output (no YAML/schema errors).

Run: `docker compose build api`
Expected: exits 0, ends with `Successfully tagged` or an equivalent BuildKit "naming to ... done" line — no build errors.

- [ ] **Step 6: Boot the full stack and smoke-test it**

Run: `docker compose up -d`
Expected: `nats`, `postgres`, `api` all report `Started`/`Running`.

Run: `curl -s -X POST http://localhost:8080/api/commands/CreateProject -d '{"idea":"nước ấm","durationSec":30,"sceneCount":1,"tone":"casual"}'`
Expected: JSON body `{"projectId":"<uuid>"}`.

Run: `curl -s http://localhost:8080/api/state`
Expected: JSON body `{"projects":[{"projectId":"<uuid>","idea":"nước ấm","status":"draft","spentUsd":0,"approved":false,"outputPath":null}]}`.

Run: `docker compose down`
Expected: all three containers stop and are removed.

- [ ] **Step 7: Commit**

```bash
git add api/src/index.ts api/Dockerfile docker-compose.yml
git commit -m "feat(api): bootstrap wiring, Dockerfile, and postgres+api compose services"
```

---

## Task 22: Full command-flow integration test (capstone)

**Files:**
- Create: `api/src/e2e.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Write `api/src/e2e.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPool, migrate, type Database } from './db.js'
import { connectBus, ensureStreams, createEventStore, type Bus } from './nats.js'
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

describe('full command flow (integration)', () => {
  let db: Database
  let bus: Bus | null = null
  let reachable = true

  beforeAll(async () => {
    db = createPool(DATABASE_URL)
    try {
      await db.query('SELECT 1')
      await migrate(db)
    } catch {
      reachable = false
    }
    try {
      bus = await connectBus(NATS_URL)
      await ensureStreams(bus.jsm)
    } catch {
      bus = null
    }
  })

  afterAll(async () => {
    await db.end()
    await bus?.nc.drain()
  })

  it('CreateProject → GenerateScript → ResolveMaterial → (worker fakes MaterialResolved) → GenerateVoiceovers → RequestApproval → ApproveStoryboard → (worker fakes RenderCompleted) → Publish, projected end to end', async (ctx) => {
    ctx.skip(!reachable || bus === null, 'needs both local Postgres and local NATS')
    if (bus === null) return

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
  })
})
```

- [ ] **Step 2: Run the test to verify it fails without live services, and passes with them**

Run (no services running): `cd api && npx vitest run src/e2e.integration.test.ts`
Expected: PASS — 1 test, reported as skipped (not a failure) since `ctx.skip` short-circuits before any assertion runs.

Run: `docker compose up -d nats` then start the throwaway Postgres from the prerequisites section (or `docker compose up -d postgres` after Task 21), then `cd api && npx vitest run src/e2e.integration.test.ts`
Expected: FAIL first — this is TDD in reverse only in the sense that Steps 1–2 already wrote real implementation code in prior tasks; if this fails, it is a genuine integration bug in the wiring across Tasks 1–21, not a missing stub. Debug via the failing assertion's message before proceeding.

- [ ] **Step 3: Fix any wiring bug surfaced, then re-run until it passes**

There is no new production code to write for this task — Task 22 exists to catch integration mistakes between Tasks 1–21 (e.g. a status string typo between `aggregate.ts`'s `LEGAL_FROM` and `projections.ts`'s `UPDATE ... SET status = '...'` literals). If it fails, grep both files for the mismatched status string and align them, then re-run.

Run: `cd api && npx vitest run src/e2e.integration.test.ts`
Expected: PASS — 1 test passed (not skipped).

- [ ] **Step 4: Run the entire `api/` suite one more time**

Run: `cd api && npx vitest run`
Expected: PASS — every test file green (integration tests either passing or skipped, never failing).

Run: `cd api && npx tsc -p tsconfig.json --noEmit`
Expected: exits 0, no type errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/e2e.integration.test.ts
git commit -m "test(api): capstone integration test for the full P1 command flow"
```

---

## Self-Review

**1. Spec coverage** — mapping each SCOPE item from the assignment to the task(s) that implement it:

| Scope item | Task(s) |
|---|---|
| 1. Scaffold `api/` (package.json, tsconfig, vitest, deps, HTTP layer, Context7-verified NATS/pg APIs) | 1 (scaffold), 4–6 (`nats.ts`, Context7-verified against `/nats-io/nats.js`), 19–20 (`node:http`, no framework) |
| 2. `events.ts` promoted verbatim | 2 |
| 3. `db.ts` — Pool + `migrate()`, 4 tables | 3 |
| 4. `nats.ts` — connect, ensureStreams, publishEvent, dispatchJob, consumeEvents | 4, 5, 6 |
| 5. `aggregate.ts` — `foldProject` reuse + invariant guards | 7 |
| 6. `cost.ts` — projectCost/admit/ledger, `scriptUsd=0`, TTS chars×rate | 8, 9 (`admit`/`projectCost` folded into `AdmitResult`/`ProjectState.spentUsd` — see note below), 11 (scriptUsd=0 enforced in `generateScript`) |
| 7. `commands.ts` — 7 handlers + injected `ScriptGenerator` seam | 10–14 (handlers), 15 (P1 stub) |
| 8. `projections.ts` — durable consumer fold + rebuild-from-seq-0 | 16–18 |
| 9. `http.ts` — POST commands (idempotencyKey), GET state/project, static SPA + `/media/*` | 19, 20 |
| 10. `index.ts`, `Dockerfile`, compose extension without breaking `nats` | 21 |

Gap fixed during drafting: the original scope text names a `projectCost` function separately from `admit`. Task 8 implements `admit(state, additionalUsd, capUsd)` (which reads `state.spentUsd` — `ProjectState`'s own field — as "cost so far") rather than a standalone `projectCost(state)` wrapper; a one-line `projectCost` alias was judged redundant (`state.spentUsd` already *is* that value with no derivation needed) and was dropped to avoid a pointless indirection — flagging this explicitly since the scope text mentioned it by name.

**2. Placeholder scan** — no `TODO`/`TBD`/"add error handling"/"similar to Task N" strings appear anywhere in code steps; every step's code block is a complete, compilable unit given the prior steps in its file. Two intentional, fully-functional (not vague) interim implementations are called out in comments, both documented here for transparency rather than hidden:
   - `api/src/script.ts`'s `stubScriptGenerator` (Task 15) — a deterministic, working fake; P2 replaces the wiring in `index.ts`, not the `ScriptGenerator` interface.
   - `commands.ts`'s `publish` handler (Task 14) — synthesizes `platform`/`postId`/`url` from the command body since the frozen contract (index §5) gives `Publish` only `{projectId, caption, privacy}` as input but requires those three fields on the `Published` event; real TikTok publish is a Go-worker concern outside P1's scope. Both are real, tested code paths, not "implement later" markers.

**3. Type consistency** — cross-checked against index.md and across files:
   - `ProjectStatus`/`ProjectState`/`VidgenEvent`/`Scene` are defined once in `events.ts` (Task 2) and imported everywhere else — never redefined.
   - `EventStore` is defined in `nats.ts` (Task 6) and re-exported (not redefined) from `commands.ts` (Task 10).
   - `ScriptGenerator.generateScenes(idea, durationSec, sceneCount, tone): Promise<{ scenes: Scene[] }>` — the exact signature requested — is defined once in `commands.ts` (Task 10) and implemented identically by `script.ts`'s stub (Task 15).
   - `Publisher` (Task 5) is the narrow structural interface `publishEvent`/`dispatchJob`/`commands.ts` depend on; the real `JetStreamClient` from `@nats-io/jetstream` satisfies it structurally, and test fakes only need to implement `publish()` — verified working in Tasks 10–14's unit tests and Tasks 6/16–18/22's integration tests against the real client.
   - `CommandContext { store, js, scriptGen, now, costCapUsd }` (Task 10) is constructed once via `createCommandContext` and used unchanged by all 7 handlers (Tasks 10–14) and by `index.ts` (Task 21).
   - `Database = pg.Pool` (Task 3) is the single alias used by `cost.ts`, `projections.ts`, and `http.ts` — no file redeclares its own pool type.
   - Cost cap default: `DEFAULT_COST_CAP_USD = 0.15` (Task 8) matches index §6 exactly (not the Go CLI's old `0.10`); `FPT_TTS_USD_PER_CHAR = 0.00001` (Task 8) matches `internal/cost/estimator.go`'s `FPTAIPerChar` value, confirmed by reading that file directly rather than assuming.
   - `eventId`/`eventSubject`/`jobSubject` (Task 5) implement the exact schemes frozen in index §4 (`<type>-<projectId>-<sceneIdx|'-'>` and `vidgen.evt.<projectId>.<type>` / `vidgen.job.<kind>.<projectId>.<scene>`), verified with concrete unit-test assertions rather than just prose.
   - `ProjectStatus` transition table in `aggregate.ts` (Task 7) — `LEGAL_FROM` — was cross-checked against `projections.ts`'s literal SQL status strings (Tasks 16–18) for exact spelling (`'draft'`, `'scripted'`, `'material'`, `'awaiting_approval'`, `'approved'`, `'rendered'`, `'published'`, `'failed'`); Task 22's capstone test additionally exercises the full chain end to end specifically to catch any drift here.

No unresolved gaps remain against the ground-truth documents. P1 is fully self-contained and runnable (`docker compose up -d`) before P2 exists, since Task 15's stub lets `GenerateScript` work standalone.
