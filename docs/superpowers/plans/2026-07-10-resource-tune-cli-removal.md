# Resource + Tune Parity + CLI Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `--resource` (local asset upload) and `tune` (voice/speed/caption/music) capabilities in the webapp, then delete the legacy CLI.

**Architecture:** Add `StyleSet` event + `TuneProject` command (the one ratified contract change); add `POST /projects/:id/assets` multipart upload; fix api payload filling so workers receive voice/speed/style/music from folded state; wire music resolution into the render worker; add TunePanel UI; gate on docker E2E; delete root Go module + CLI packages.

**Tech Stack:** TypeScript/bun (api + frontend), Go 1.25 (worker), NATS JetStream, Postgres 16, Vite/React/Zustand (frontend), impeccable skill for TunePanel UI.

**Worktree:** `~/Kanna/video-generation-skill-p5` on branch `feat/p5-resource-tune-cli-removal`

**Run tests:**
- api: `cd api && bun test` (unit) — never run integration tests (needs live NATS+Postgres)
- worker: `cd worker && go test ./internal/jobhandler/... ./internal/render/...` (targeted — never `go test ./...` which runs integration tests)
- frontend: `cd frontend && bun test`

---

## File map

| File | Action | What changes |
|---|---|---|
| `api/src/events.ts` | Modify | Add `StyleSet` variant + `style` to `ProjectState` + update `foldProject` |
| `api/src/nats.ts` | Modify | `eventId` handles `StyleSet.uid` |
| `api/migrations/002_style.sql` | Create | `style` JSONB col on projects + `uploaded_assets` table |
| `api/src/db.ts` | Modify | Run 002 migration |
| `api/src/aggregate.ts` | Modify | `CommandName` gains `TuneProject`; `ValidationError`; `LEGAL_FROM` entry |
| `api/src/commands.ts` | Modify | `mediaDir` in ctx; `TuneInput` + `tuneProject`; fix all dispatch payloads |
| `api/src/projections.ts` | Modify | Handle `StyleSet`; expose `style` from `getProject` |
| `api/src/http.ts` | Modify | Wire `TuneProject`; add upload/list routes; catch `ValidationError` → 400 |
| `worker/internal/jobhandler/types.go` | Modify | `RenderMusicJob.Search string` |
| `worker/internal/jobhandler/render.go` | Modify | Inject `musicSource`; resolve Jamendo when `Search != ""` |
| `worker/cmd/worker/main.go` | Modify | Build + inject music source into `NewRenderHandler` |
| `frontend/src/store/events.ts` | Modify | Mirror api events.ts changes (same `StyleSet` + `style`) |
| `frontend/src/store/store.ts` | Modify | Add `TuneInput`; `tuneProject`, `uploadAssets`, `fetchAssets` |
| `frontend/src/components/TunePanel.tsx` | Create | Voice/speed/caption/music/upload controls |
| `frontend/src/components/TunePanel.test.tsx` | Create | Unit tests |
| `frontend/src/components/ProjectCard.tsx` | Modify | Render `TunePanel` |
| `api/src/events.test.ts` | Modify | StyleSet fold tests |
| `api/src/commands.test.ts` | Modify | TuneProject + payload-filling tests |
| `api/src/projections.ts` (test) | Modify | StyleSet projection test |
| `worker/internal/jobhandler/render_test.go` | Modify | Music resolution test |

---

## Task 1 — StyleSet event + ProjectState.style (api + frontend events.ts)

**Files:**
- Modify: `api/src/events.ts`
- Modify: `api/src/events.test.ts`
- Modify: `frontend/src/store/events.ts` (identical changes, keep in sync)

- [ ] **Step 1: Write failing tests in `api/src/events.test.ts`**

```ts
import { describe, it, expect } from 'bun:test'
import { foldProject, DEFAULT_STYLE } from './events.js'

describe('foldProject StyleSet', () => {
  it('returns default style when no StyleSet emitted', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
    ])
    expect(s.style).toEqual(DEFAULT_STYLE)
  })

  it('applies first StyleSet', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't1', uid: 'u1',
        voice: 'lannhi', speed: 1, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
    ])
    expect(s.style.voice).toBe('lannhi')
    expect(s.style.speed).toBe(1)
    expect(s.style.music).toBeNull()
  })

  it('last StyleSet wins (full snapshot)', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't1', uid: 'u1',
        voice: 'lannhi', speed: 1, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't2', uid: 'u2',
        voice: 'banmai', speed: 0, captionStyle: { fontName: 'Times', fontSize: 48 },
        music: { search: 'upbeat', volume: 0.5 } },
    ])
    expect(s.style.voice).toBe('banmai')
    expect(s.style.captionStyle.fontName).toBe('Times')
    expect(s.style.music).toEqual({ search: 'upbeat', volume: 0.5 })
  })
})
```

- [ ] **Step 2: Run — verify FAIL** (`cd api && bun test --test-name-pattern "foldProject StyleSet"`)

Expected: `Cannot find name 'DEFAULT_STYLE'` or similar import error.

- [ ] **Step 3: Update `api/src/events.ts`**

```ts
export type Scene = { idx: number; narration: string; visual: string }

export type StyleSpec = {
  voice: string
  speed: number
  captionStyle: { fontName: string; fontSize: number }
  music: { search: string; volume: number } | null
}

export const DEFAULT_STYLE: StyleSpec = {
  voice: 'banmai',
  speed: 0,
  captionStyle: { fontName: 'Arial', fontSize: 64 },
  music: null,
}

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
  | { v: 1; type: 'StyleSet'; projectId: string; at: string; uid: string; voice: string; speed: number; captionStyle: { fontName: string; fontSize: number }; music: { search: string; volume: number } | null }

export type ProjectStatus = 'draft' | 'material' | 'scripted' | 'awaiting_approval' | 'approved' | 'rendered' | 'published' | 'failed'

export type ProjectState = {
  projectId: string
  status: ProjectStatus
  scenes: Scene[]
  spentUsd: number
  approved: boolean
  outputPath?: string
  style: StyleSpec
}

export function foldProject(events: VidgenEvent[]): ProjectState {
  const s: ProjectState = { projectId: '', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: { ...DEFAULT_STYLE, captionStyle: { ...DEFAULT_STYLE.captionStyle } } }
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
      case 'StyleSet':
        s.style = { voice: e.voice, speed: e.speed, captionStyle: { ...e.captionStyle }, music: e.music }
        break
    }
  }
  return s
}
```

- [ ] **Step 4: Apply same changes to `frontend/src/store/events.ts`**

Replace the entire file with the same content as `api/src/events.ts` above (identical — same frozen contract). Keep the file comment at top:

```ts
// Frozen event contract — copied verbatim from api/src/events.ts.
// Do NOT alter field shapes here. If the event union changes, update BOTH
// this file and api/src/events.ts in the same commit.
```

Then paste the same `StyleSpec`, `DEFAULT_STYLE`, `VidgenEvent`, `ProjectState`, `foldProject` definitions.

- [ ] **Step 5: Run api tests — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test --test-name-pattern "foldProject"
```

Expected: all `foldProject` tests pass.

- [ ] **Step 6: Run frontend tests — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test
```

Expected: all tests pass (no existing test references `style` field yet).

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/events.ts api/src/events.test.ts frontend/src/store/events.ts
git commit -m "feat(events): StyleSet event + ProjectState.style (contract change §1)"
```

---

## Task 2 — nats.ts eventId handles StyleSet uid

**Files:**
- Modify: `api/src/nats.ts`
- Modify: `api/src/nats.test.ts`

- [ ] **Step 1: Write failing test in `api/src/nats.test.ts`**

Add to the existing test file:

```ts
import { eventId } from './nats.js'

describe('eventId StyleSet', () => {
  it('uses uid field so each tune call gets a unique msgID', () => {
    const e1 = { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't', uid: 'abc123',
      voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null }
    const e2 = { ...e1, uid: 'xyz789' }
    expect(eventId(e1)).toBe('StyleSet-p1-abc123')
    expect(eventId(e2)).toBe('StyleSet-p1-xyz789')
    expect(eventId(e1)).not.toBe(eventId(e2))
  })
})
```

- [ ] **Step 2: Run — verify FAIL**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test --test-name-pattern "eventId StyleSet"
```

Expected: FAIL — eventId returns `StyleSet-p1--` (sceneless fallback).

- [ ] **Step 3: Update `eventId` in `api/src/nats.ts`**

Replace the existing `eventId` function:

```ts
export function eventId(event: VidgenEvent): string {
  if (event.type === 'StyleSet') return `StyleSet-${event.projectId}-${event.uid}`
  const sceneIdx = 'sceneIdx' in event ? String(event.sceneIdx) : '-'
  return `${event.type}-${event.projectId}-${sceneIdx}`
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test --test-name-pattern "eventId"
```

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/nats.ts api/src/nats.test.ts
git commit -m "feat(nats): StyleSet eventId uses uid for per-tune uniqueness"
```

---

## Task 3 — DB migration 002_style.sql

**Files:**
- Create: `api/migrations/002_style.sql`
- Modify: `api/src/db.ts`

- [ ] **Step 1: Create `api/migrations/002_style.sql`**

```sql
-- Style settings projection from StyleSet events (last-write-wins per project).
-- uploaded_assets tracks files uploaded via POST /projects/:id/assets.
-- Both statements are idempotent: safe to re-run.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS style JSONB;

CREATE TABLE IF NOT EXISTS uploaded_assets (
  id          SERIAL PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  path        TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, filename)
);
```

- [ ] **Step 2: Update `api/src/db.ts` to run migration 002**

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
  for (const name of ['001_init.sql', '002_style.sql']) {
    const sqlPath = path.join(__dirname, '..', 'migrations', name)
    const sql = await readFile(sqlPath, 'utf8')
    await db.query(sql)
  }
}
```

- [ ] **Step 3: Run api tests — verify no breakage**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
```

Expected: all unit tests pass (no live DB needed for unit tests).

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/migrations/002_style.sql api/src/db.ts
git commit -m "feat(db): add style column + uploaded_assets table (migration 002)"
```

---

## Task 4 — TuneProject command + aggregate updates

**Files:**
- Modify: `api/src/aggregate.ts`
- Modify: `api/src/commands.ts`
- Modify: `api/src/commands.test.ts`

- [ ] **Step 1: Write failing tests — add to `api/src/commands.test.ts`**

Add these test blocks after the existing ones:

```ts
import { tuneProject } from './commands.js'
import { ValidationError } from './aggregate.js'

const preScriptedEvents = [
  { v: 1 as const, type: 'ProjectCreated' as const, projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
]

describe('tuneProject', () => {
  it('emits StyleSet with full style snapshot', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await tuneProject(ctx, { projectId: 'p1', voice: 'lannhi', speed: 1 })
    const ev = store.events.at(-1)
    expect(ev?.type).toBe('StyleSet')
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.voice).toBe('lannhi')
    expect(ev.speed).toBe(1)
    expect(ev.captionStyle).toEqual({ fontName: 'Arial', fontSize: 64 })
    expect(ev.music).toBeNull()
    expect(state.style.voice).toBe('lannhi')
  })

  it('merges partial input over current style', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't1', uid: 'u0',
        voice: 'lannhi', speed: 2, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await tuneProject(ctx, { projectId: 'p1', speed: -1 })
    const ev = store.events.at(-1)
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.voice).toBe('lannhi')  // kept from previous
    expect(ev.speed).toBe(-1)        // updated
  })

  it('explicit music null clears music', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't1', uid: 'u0',
        voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 },
        music: { search: 'upbeat', volume: 0.5 } },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await tuneProject(ctx, { projectId: 'p1', music: null })
    const ev = store.events.at(-1)
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.music).toBeNull()
  })

  it('rejects unknown voice', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', voice: 'unknown' })).rejects.toThrow(ValidationError)
  })

  it('rejects speed out of range', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', speed: 4 })).rejects.toThrow(ValidationError)
  })

  it('rejects music volume > 1', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', music: { search: 'chill', volume: 1.5 } }))
      .rejects.toThrow(ValidationError)
  })

  it('rejects tuning an approved project', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'ScriptGenerated' as const, projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 },
      { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't2', sceneIdx: 0, source: 'pexels', assetPath: '/a' },
      { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't3' },
      { v: 1 as const, type: 'ApprovalGranted' as const, projectId: 'p1', at: 't4' },
    ])
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', speed: 1 })).rejects.toThrow(InvalidTransitionError)
  })
})
```

- [ ] **Step 2: Run — verify FAIL**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test --test-name-pattern "tuneProject"
```

Expected: import errors / function not found.

- [ ] **Step 3: Update `api/src/aggregate.ts`**

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
  | 'TuneProject'
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

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

const LEGAL_FROM: Record<Exclude<CommandName, 'CreateProject'>, ReadonlyArray<ProjectState['status']>> = {
  GenerateScript: ['draft'],
  ResolveMaterial: ['scripted'],
  GenerateVoiceovers: ['material'],
  RequestApproval: ['material'],
  ApproveStoryboard: ['awaiting_approval'],
  TuneProject: ['draft', 'scripted', 'material', 'awaiting_approval'],
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

- [ ] **Step 4: Update `api/src/commands.ts`**

Replace entire file:

```ts
import { randomUUID } from 'node:crypto'
import type { Scene, VidgenEvent, ProjectState, StyleSpec } from './events.js'
import { foldProject, DEFAULT_STYLE } from './events.js'
import { assertCanCreate, assertExists, assertTransition, ValidationError } from './aggregate.js'
import type { EventStore, Publisher } from './nats.js'
import { publishEvent, dispatchJob } from './nats.js'
import { admit, costCapFromEnv, projectedTtsUsd, CostCapExceededError } from './cost.js'
import path from 'node:path'

export type { EventStore } from './nats.js'

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

export interface TuneInput {
  projectId: string
  voice?: string
  speed?: number
  captionStyle?: { fontName: string; fontSize: number }
  music?: { search: string; volume: number } | null
}

export interface CommandContext {
  store: EventStore
  js: Publisher
  scriptGen: ScriptGenerator
  now: () => string
  costCapUsd: number
  mediaDir: string
}

export function createCommandContext(
  store: EventStore,
  js: Publisher,
  scriptGen: ScriptGenerator,
  costCapUsd: number = costCapFromEnv(),
  mediaDir: string = 'media',
): CommandContext {
  return { store, js, scriptGen, now: () => new Date().toISOString(), costCapUsd, mediaDir }
}

/** Valid FPT.AI voice identifiers — mirrors worker/internal/domain/project.go AllVoices(). */
const VALID_VOICES = ['banmai', 'thuminh', 'lannhi', 'linhsan', 'leminh', 'giahuy', 'myan']

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
    scriptUsd: 0,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function tuneProject(ctx: CommandContext, input: TuneInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('TuneProject', state)

  if (input.voice !== undefined && !VALID_VOICES.includes(input.voice)) {
    throw new ValidationError(`voice must be one of: ${VALID_VOICES.join(', ')}`)
  }
  if (input.speed !== undefined && (!Number.isInteger(input.speed) || input.speed < -3 || input.speed > 3)) {
    throw new ValidationError('speed must be integer in range -3..3')
  }
  if (input.music != null && (input.music.volume <= 0 || input.music.volume > 1)) {
    throw new ValidationError('music.volume must be in range (0, 1]')
  }

  const cur = state.style
  // 'music' key present in input (even if null) means explicit clear; absent means keep current
  const music = 'music' in input ? (input.music ?? null) : cur.music

  const event: VidgenEvent = {
    v: 1,
    type: 'StyleSet',
    projectId: input.projectId,
    at: ctx.now(),
    uid: randomUUID(),
    voice: input.voice ?? cur.voice,
    speed: input.speed ?? cur.speed,
    captionStyle: input.captionStyle ?? cur.captionStyle,
    music,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

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

  const projectMediaDir = path.join(ctx.mediaDir, input.projectId)
  const renderJob: Record<string, unknown> = {
    scenes: state.scenes.map((s) => ({
      mediaPath: path.join(projectMediaDir, `material${s.idx}.mp4`),
      audioPath: path.join(projectMediaDir, `tts${s.idx}.mp3`),
      isImage: false,
      durationSec: 0,
      mediaDurationSec: 0,
    })),
    assPath: path.join(projectMediaDir, 'captions.ass'),
    outputPath: path.join(projectMediaDir, 'output.mp4'),
  }
  if (state.style.music !== null) {
    renderJob.music = { search: state.style.music.search, volume: state.style.music.volume, path: '' }
  }
  await dispatchJob(ctx.js, 'render', input.projectId, null, renderJob)
  return foldProject([...events, event])
}

export async function publish(ctx: CommandContext, input: PublishInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('Publish', state)
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

export async function resolveMaterial(ctx: CommandContext, input: ResolveMaterialInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ResolveMaterial', state)

  // Load uploaded assets for this project (filesystem-based, ordered by filename)
  const projectMediaDir = path.join(ctx.mediaDir, input.projectId)

  for (const scene of state.scenes) {
    const destPath = path.join(projectMediaDir, `material${scene.idx}.mp4`)
    // localAssetPath will be filled by http layer for scenes that have an uploaded file;
    // passed as empty string here — http layer sets it via resolveMaterialWithAssets below.
    await dispatchJob(ctx.js, 'material', input.projectId, scene.idx, {
      query: scene.visual,
      destPath,
    })
  }
  return state
}

/** Variant of resolveMaterial that injects uploaded local asset paths.
 * Called by the http layer when the project has uploaded assets. */
export async function resolveMaterialWithAssets(
  ctx: CommandContext,
  input: ResolveMaterialInput,
  uploadedPaths: string[],
): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ResolveMaterial', state)

  const projectMediaDir = path.join(ctx.mediaDir, input.projectId)

  for (const scene of state.scenes) {
    const destPath = path.join(projectMediaDir, `material${scene.idx}.mp4`)
    const localAssetPath = uploadedPaths[scene.idx] ?? ''
    await dispatchJob(ctx.js, 'material', input.projectId, scene.idx, {
      query: scene.visual,
      destPath,
      ...(localAssetPath ? { localAssetPath } : {}),
    })
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

  const costEvent: VidgenEvent = {
    v: 1,
    type: 'CostProjected',
    projectId: input.projectId,
    at: ctx.now(),
    projectedUsd: result.projectedUsd,
    capUsd: result.capUsd,
  }
  await ctx.store.append(costEvent)
  await publishEvent(ctx.js, costEvent)

  const projectMediaDir = path.join(ctx.mediaDir, input.projectId)

  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'tts', input.projectId, scene.idx, {
      narration: scene.narration,
      voice: state.style.voice,
      speed: state.style.speed,
      destPath: path.join(projectMediaDir, `tts${scene.idx}.mp3`),
    })
  }

  // One caption job for the whole project.
  // startOffsetSec is 0 for all scenes — accurate per-scene timestamps but
  // cross-scene offsets require actual audio durations (known limitation, same
  // as pre-P5 state).
  await dispatchJob(ctx.js, 'caption', input.projectId, null, {
    sceneAudio: state.scenes.map((s) => ({
      audioPath: path.join(projectMediaDir, `tts${s.idx}.mp3`),
      startOffsetSec: 0,
    })),
    style: {
      font_name: state.style.captionStyle.fontName,
      font_size: state.style.captionStyle.fontSize,
      primary: '#FFFFFF',
      outline: '#000000',
      bold: true,
    },
    destPath: path.join(projectMediaDir, 'captions.ass'),
  })

  return foldProject([...events, costEvent])
}
```

- [ ] **Step 5: Run — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test --test-name-pattern "tuneProject"
```

- [ ] **Step 6: Run full api unit tests — verify no regression**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
```

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/aggregate.ts api/src/commands.ts api/src/commands.test.ts
git commit -m "feat(commands): TuneProject cmd + StyleSet event + payload filling + mediaDir"
```

---

## Task 5 — projections.ts handles StyleSet + exposes style

**Files:**
- Modify: `api/src/projections.ts`
- Modify: `api/src/http.ts` (ProjectDetail type — style field)

- [ ] **Step 1: Update `applyProjection` in `api/src/projections.ts`**

Add this case in the `switch` block, after `case 'RunFailed'`:

```ts
    case 'StyleSet':
      await db.query(
        `UPDATE projects SET style = $2, updated_at = $3 WHERE project_id = $1`,
        [event.projectId, JSON.stringify({ voice: event.voice, speed: event.speed, captionStyle: event.captionStyle, music: event.music }), event.at],
      )
      break
```

- [ ] **Step 2: Update `getProject` in `api/src/http.ts` to expose style**

In the `getProject` function, update the project query to select `style`:

```ts
export async function getProject(db: Database, projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null; style: unknown
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path, style FROM projects WHERE project_id = $1', [projectId])
```

And update the return object to include `style`:

```ts
  return {
    projectId: row.project_id,
    idea: row.idea,
    status: row.status,
    spentUsd: Number(row.spent_usd),
    approved: row.approved,
    outputPath: row.output_path,
    style: (row.style ?? null) as StyleSpec | null,
    scenes: sceneResult.rows.map(/* unchanged */),
  }
```

Update the `ProjectDetail` interface:

```ts
import type { StyleSpec } from './events.js'

export interface ProjectDetail extends ProjectSummary {
  style: StyleSpec | null
  scenes: Array<{ idx: number; narration: string; visual: string; materialPath: string | null; mp3Path: string | null; assPath: string | null }>
}
```

- [ ] **Step 3: Run api unit tests — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
```

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/projections.ts api/src/http.ts
git commit -m "feat(projections): fold StyleSet into projects.style; expose in GET /api/projects/:id"
```

---

## Task 6 — http.ts: TuneProject wiring + asset upload/list routes

**Files:**
- Modify: `api/src/http.ts`

- [ ] **Step 1: Add TuneProject to COMMAND_HANDLERS and ValidationError handling**

In `http.ts`, update the imports from commands:

```ts
import type {
  ResolveMaterialInput, GenerateVoiceoversInput, RequestApprovalInput, ApproveStoryboardInput,
  GenerateScriptInput, TuneInput,
} from './commands.js'
import * as commands from './commands.js'
import { ValidationError } from './aggregate.js'
```

Add `parseTuneInput` helper:

```ts
export function parseTuneInput(body: Record<string, unknown>): TuneInput {
  const projectId = requireProjectId(body)
  const input: TuneInput = { projectId }
  if ('voice' in body) {
    if (typeof body.voice !== 'string') throw new HttpError(400, 'voice must be a string')
    input.voice = body.voice
  }
  if ('speed' in body) {
    if (typeof body.speed !== 'number') throw new HttpError(400, 'speed must be a number')
    input.speed = body.speed
  }
  if ('captionStyle' in body) {
    const cs = body.captionStyle
    if (typeof cs !== 'object' || cs === null || Array.isArray(cs)) throw new HttpError(400, 'captionStyle must be an object')
    const { fontName, fontSize } = cs as Record<string, unknown>
    if (typeof fontName !== 'string' || typeof fontSize !== 'number') throw new HttpError(400, 'captionStyle requires fontName:string, fontSize:number')
    input.captionStyle = { fontName, fontSize }
  }
  if ('music' in body) {
    if (body.music === null) {
      input.music = null
    } else {
      const m = body.music
      if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new HttpError(400, 'music must be an object or null')
      const { search, volume } = m as Record<string, unknown>
      if (typeof search !== 'string' || typeof volume !== 'number') throw new HttpError(400, 'music requires search:string, volume:number')
      input.music = { search, volume }
    }
  }
  return input
}
```

Add to `COMMAND_HANDLERS`:

```ts
  TuneProject: (ctx, body) => commands.tuneProject(ctx, parseTuneInput(body)),
```

Update the error catch block in `handleCommand` and `routeRequest`:

```ts
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
      return
    }
    if (err instanceof ValidationError) {
      sendJson(res, 400, { error: err.message })
      return
    }
    console.error('http handler error:', err)
    sendJson(res, 500, { error: 'internal error' })
  }
```

(Update both the `handleCommand` and `routeRequest` catch blocks.)

- [ ] **Step 2: Add asset upload and list routes**

Add these imports at the top:

```ts
import { mkdir, writeFile, readdir, stat as fsStat } from 'node:fs/promises'
```

Add asset helper functions before `routeRequest`:

```ts
const ALLOWED_UPLOAD_EXTS = new Set(['.mp4', '.mov', '.jpg', '.jpeg', '.png'])
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
}

async function handleUploadAsset(config: HttpConfig, projectId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES) {
      sendJson(res, 413, { error: 'file too large (max 100 MB)' })
      return
    }
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    sendJson(res, 400, { error: 'expected multipart/form-data' })
    return
  }

  // Parse multipart using bun's Web Request API
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    sendJson(res, 400, { error: 'invalid multipart body' })
    return
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    sendJson(res, 400, { error: 'multipart field "file" is required' })
    return
  }

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
    sendJson(res, 400, { error: `file type ${ext} not allowed; use: ${[...ALLOWED_UPLOAD_EXTS].join(', ')}` })
    return
  }

  const safeName = sanitizeFilename(file.name)
  const assetsDir = path.join(config.mediaDir, projectId, 'assets')
  await mkdir(assetsDir, { recursive: true })
  const destPath = path.join(assetsDir, safeName)
  const bytes = await file.arrayBuffer()
  await writeFile(destPath, Buffer.from(bytes))

  sendJson(res, 200, { filename: safeName, path: destPath, sizeBytes: file.size })
}

async function handleListAssets(config: HttpConfig, projectId: string, res: ServerResponse): Promise<void> {
  const assetsDir = path.join(config.mediaDir, projectId, 'assets')
  try {
    const names = await readdir(assetsDir)
    const items = await Promise.all(
      names.map(async (name) => {
        const info = await fsStat(path.join(assetsDir, name))
        return { filename: name, sizeBytes: info.size }
      }),
    )
    sendJson(res, 200, { assets: items })
  } catch {
    sendJson(res, 200, { assets: [] })
  }
}
```

Add routes in `routeRequest` before the `GET /media` handler:

```ts
    if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/assets$/)) {
      const projectId = url.pathname.split('/')[3]!
      await handleUploadAsset(config, projectId, req, res)
      return
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/assets$/)) {
      const projectId = url.pathname.split('/')[3]!
      await handleListAssets(config, projectId, res)
      return
    }
```

Also update `ResolveMaterial` in `COMMAND_HANDLERS` to use uploaded assets:

```ts
  ResolveMaterial: async (ctx, body) => {
    const projectId = requireProjectId(body)
    // Load uploaded assets from filesystem, assign to scenes in upload order
    const assetsDir = path.join(ctx.mediaDir, projectId, 'assets')
    let uploadedPaths: string[] = []
    try {
      const names = (await readdir(assetsDir)).sort()
      uploadedPaths = names.map((n) => path.join(assetsDir, n))
    } catch {
      // no assets uploaded — all scenes fall back to stock
    }
    return commands.resolveMaterialWithAssets(ctx, { projectId }, uploadedPaths)
  },
```

- [ ] **Step 3: Run api unit tests**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
```

Expected: all unit tests pass (http unit tests don't exercise upload routes directly).

- [ ] **Step 4: Run TypeScript typecheck**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun run typecheck
```

Fix any type errors before proceeding.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/http.ts
git commit -m "feat(http): TuneProject command + asset upload/list routes + ValidationError 400"
```

---

## Task 7 — Update api/src/index.ts to pass mediaDir into CommandContext

**Files:**
- Modify: `api/src/index.ts`

- [ ] **Step 1: Update `createCommandContext` call**

Replace:

```ts
  const ctx = createCommandContext(store, bus.js, sdkScriptGenerator, costCapFromEnv())
```

With:

```ts
  const ctx = createCommandContext(store, bus.js, sdkScriptGenerator, costCapFromEnv(), mediaDir)
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add api/src/index.ts
git commit -m "fix(api): pass mediaDir into CommandContext from env"
```

---

## Task 8 — Worker: RenderMusicJob.Search + music resolution

**Files:**
- Modify: `worker/internal/jobhandler/types.go`
- Modify: `worker/internal/jobhandler/render.go`
- Modify: `worker/internal/jobhandler/render_test.go`
- Modify: `worker/cmd/worker/main.go`

- [ ] **Step 1: Write failing test in `worker/internal/jobhandler/render_test.go`**

Add this test case to the existing test file (find the existing test, add a new table row or describe block):

```go
// Add this test to the file, or add a row to the existing table:
func TestRenderHandlerMusicSearchResolution(t *testing.T) {
    resolved := make(chan string, 1)
    mockMusic := &mockMusicSource{
        searchFn: func(ctx context.Context, q music.Query) ([]music.Track, error) {
            return []music.Track{{ID: "1", Name: "Chill Track", DurationSec: 60, DownloadURL: "http://example.com/track.mp3"}}, nil
        },
        downloadFn: func(ctx context.Context, track music.Track, dest string) error {
            resolved <- dest
            return nil
        },
    }

    store := &fakeStore{}
    renderer := &fakeRenderer{outputPath: "/media/p1/output.mp4"}
    h := NewRenderHandler(renderer, mockMusic, store)

    job := RenderJob{
        ProjectID:  "p1",
        Scenes:     []RenderSceneJob{{MediaPath: "/m.mp4", AudioPath: "/a.mp3", DurationSec: 5, MediaDurationSec: 5}},
        ASSPath:    "/cap.ass",
        OutputPath: "/media/p1/output.mp4",
        Music:      &RenderMusicJob{Search: "chill acoustic", Volume: 0.3, Path: ""},
    }

    err := h.Handle(context.Background(), "subj", job)
    if err != nil {
        t.Fatalf("Handle error: %v", err)
    }
    select {
    case dest := <-resolved:
        if dest == "" {
            t.Error("expected non-empty download dest path")
        }
    default:
        t.Error("music was not downloaded")
    }
}
```

(Add `mockMusicSource` struct to `helpers_test.go` — see Step 3.)

- [ ] **Step 2: Add mockMusicSource to `worker/internal/jobhandler/helpers_test.go`**

```go
// Add to helpers_test.go:
import "github.com/cuongtranba/video-generation-skill/worker/internal/music"

type mockMusicSource struct {
    searchFn   func(ctx context.Context, q music.Query) ([]music.Track, error)
    downloadFn func(ctx context.Context, track music.Track, dest string) error
}

func (m *mockMusicSource) Search(ctx context.Context, q music.Query) ([]music.Track, error) {
    return m.searchFn(ctx, q)
}

func (m *mockMusicSource) Download(ctx context.Context, track music.Track, dest string) error {
    return m.downloadFn(ctx, track, dest)
}
```

- [ ] **Step 3: Run — verify FAIL**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/worker && go test ./internal/jobhandler/... 2>&1 | head -30
```

Expected: compile error — `NewRenderHandler` doesn't accept music source.

- [ ] **Step 4: Update `worker/internal/jobhandler/types.go` — add Search to RenderMusicJob**

In `types.go`, change `RenderMusicJob` to:

```go
// RenderMusicJob is the optional background music track.
// When Search is set and Path is empty, the render handler resolves a track
// via the Jamendo music source at render time.
type RenderMusicJob struct {
	Search      string  `json:"search"`
	Path        string  `json:"path"`
	DurationSec float64 `json:"durationSec"`
	Volume      float64 `json:"volume"`
}
```

- [ ] **Step 5: Update `worker/internal/jobhandler/render.go`**

```go
// worker/internal/jobhandler/render.go
package jobhandler

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/music"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

// RenderHandler consumes render jobs, optionally resolves background music
// via musicSource, invokes the ffmpeg renderer, and publishes RenderCompleted
// (or RunFailed on error) to store.
type RenderHandler struct {
	renderer    render.Renderer
	musicSource music.MusicSource
	store       *eventstore.Store
}

func NewRenderHandler(renderer render.Renderer, musicSource music.MusicSource, store *eventstore.Store) *RenderHandler {
	return &RenderHandler{renderer: renderer, musicSource: musicSource, store: store}
}

func toSceneInputs(scenes []RenderSceneJob) []render.SceneInput {
	out := make([]render.SceneInput, len(scenes))
	for i, s := range scenes {
		out[i] = render.SceneInput{
			MediaPath:        s.MediaPath,
			AudioPath:        s.AudioPath,
			IsImage:          s.IsImage,
			DurationSec:      s.DurationSec,
			MediaDurationSec: s.MediaDurationSec,
		}
	}
	return out
}

func (h *RenderHandler) resolveMusicPath(ctx context.Context, m *RenderMusicJob, outputPath string) (string, error) {
	if m.Path != "" {
		return m.Path, nil
	}
	if m.Search == "" {
		return "", nil
	}
	tracks, err := h.musicSource.Search(ctx, music.Query{Tags: m.Search, Limit: 1})
	if err != nil {
		return "", fmt.Errorf("search music %q: %w", m.Search, err)
	}
	if len(tracks) == 0 {
		return "", fmt.Errorf("no music found for query %q", m.Search)
	}
	dest := filepath.Join(filepath.Dir(outputPath), "music.mp3")
	if err := h.musicSource.Download(ctx, tracks[0], dest); err != nil {
		return "", fmt.Errorf("download music %q: %w", m.Search, err)
	}
	return dest, nil
}

func (h *RenderHandler) Handle(ctx context.Context, subject string, job RenderJob) error {
	var musicInput *render.MusicInput
	if job.Music != nil {
		resolvedPath, err := h.resolveMusicPath(ctx, job.Music, job.OutputPath)
		if err != nil {
			return publishFailure(ctx, h.store, job.ProjectID, "render", -1, err)
		}
		if resolvedPath != "" {
			musicInput = &render.MusicInput{Path: resolvedPath, DurationSec: job.Music.DurationSec, Volume: job.Music.Volume}
		}
	}

	out, err := h.renderer.Render(ctx, render.RenderRequest{
		Scenes:     toSceneInputs(job.Scenes),
		ASSPath:    job.ASSPath,
		Music:      musicInput,
		OutputPath: job.OutputPath,
	})
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "render", -1, err)
	}

	ev := eventstore.NewRenderCompleted(job.ProjectID, out.OutputPath, 0)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish RenderCompleted for project %s: %w", job.ProjectID, err)
	}
	return nil
}
```

- [ ] **Step 6: Update `worker/cmd/worker/main.go` — wire music source**

Add import:

```go
"github.com/cuongtranba/video-generation-skill/worker/internal/music"
```

After `materialSource, err := ...`, add:

```go
musicSource, err := music.NewFromConfig(providers.Music, cfg.JamendoClientID)
if err != nil {
    return fmt.Errorf("build music source: %w", err)
}
```

Change `NewRenderHandler` call:

```go
renderHandler := jobhandler.NewRenderHandler(render.NewFFmpegRenderer(ffmpegBin, ffprobeBin), musicSource, store)
```

- [ ] **Step 7: Run — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/worker && go test ./internal/jobhandler/...
```

- [ ] **Step 8: Run go vet**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/worker && go vet ./...
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add worker/internal/jobhandler/types.go worker/internal/jobhandler/render.go \
        worker/internal/jobhandler/render_test.go worker/internal/jobhandler/helpers_test.go \
        worker/cmd/worker/main.go
git commit -m "feat(worker): RenderMusicJob.Search + Jamendo resolution at render time"
```

---

## Task 9 — Frontend store: TuneInput + tuneProject + uploadAssets + fetchAssets

**Files:**
- Modify: `frontend/src/store/store.ts`
- Modify: `frontend/src/store/store.test.ts`

- [ ] **Step 1: Write failing tests — add to `frontend/src/store/store.test.ts`**

```ts
// Add these tests:
describe('tuneProject', () => {
  it('posts TuneProject command', async () => {
    const calls: Array<{ url: RequestInfo; init: RequestInit }> = []
    const fetchImpl = async (url: RequestInfo, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} })
      return new Response('{}', { status: 200 })
    }
    const store = createVidgenStore({ fetchImpl: fetchImpl as typeof fetch, eventBusClient: stubBusClient() })
    await store.getState().tuneProject({ projectId: 'p1', voice: 'lannhi', speed: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/commands/TuneProject')
    const body = JSON.parse(calls[0]?.init.body as string)
    expect(body.projectId).toBe('p1')
    expect(body.voice).toBe('lannhi')
    expect(body.speed).toBe(1)
  })
})

describe('uploadAssets', () => {
  it('posts files to /api/projects/:id/assets', async () => {
    const calls: Array<{ url: RequestInfo }> = []
    const fetchImpl = async (url: RequestInfo, init?: RequestInit) => {
      calls.push({ url })
      return new Response(JSON.stringify({ filename: 'a.mp4', sizeBytes: 100 }), { status: 200 })
    }
    const store = createVidgenStore({ fetchImpl: fetchImpl as typeof fetch, eventBusClient: stubBusClient() })
    const file = new File(['content'], 'a.mp4', { type: 'video/mp4' })
    await store.getState().uploadAssets('p1', [file])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/api/projects/p1/assets')
  })
})
```

(Use the existing `stubBusClient` helper or add it if absent.)

- [ ] **Step 2: Run — verify FAIL**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test --test-name-pattern "tuneProject|uploadAssets"
```

- [ ] **Step 3: Update `frontend/src/store/store.ts`**

Add these types and extend `VidgenStore`:

```ts
export interface TuneInput {
  projectId: string
  voice?: string
  speed?: number
  captionStyle?: { fontName: string; fontSize: number }
  music?: { search: string; volume: number } | null
}

export interface UploadedAsset {
  filename: string
  sizeBytes: number
}
```

Add to `VidgenStore` interface:

```ts
  tuneProject: (input: TuneInput) => Promise<void>
  uploadAssets: (projectId: string, files: File[]) => Promise<UploadedAsset[]>
  fetchAssets: (projectId: string) => Promise<UploadedAsset[]>
```

Add implementations in `create<VidgenStore>()((set, get) => ({`:

```ts
    tuneProject: (input) => postCommand(deps.fetchImpl, 'TuneProject', input),

    uploadAssets: async (projectId, files) => {
      const results: UploadedAsset[] = []
      for (const file of files) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await deps.fetchImpl(`/api/projects/${projectId}/assets`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error(`upload ${file.name} failed: ${res.status}`)
        results.push(await res.json() as UploadedAsset)
      }
      return results
    },

    fetchAssets: async (projectId) => {
      const res = await deps.fetchImpl(`/api/projects/${projectId}/assets`)
      if (!res.ok) throw new Error(`fetchAssets failed: ${res.status}`)
      const data = await res.json() as { assets: UploadedAsset[] }
      return data.assets
    },
```

- [ ] **Step 4: Run — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add frontend/src/store/store.ts frontend/src/store/store.test.ts
git commit -m "feat(store): tuneProject + uploadAssets + fetchAssets"
```

---

## Task 10 — TunePanel component (use impeccable skill)

**Files:**
- Create: `frontend/src/components/TunePanel.tsx`
- Create: `frontend/src/components/TunePanel.test.tsx`
- Modify: `frontend/src/components/ProjectCard.tsx`

**REQUIRED:** Invoke the `impeccable` skill before writing UI code to ensure consistent UI/UX.

- [ ] **Step 1: Invoke impeccable skill**

```
/impeccable
```

Follow the skill's guidance for the TunePanel design.

- [ ] **Step 2: Write failing tests in `frontend/src/components/TunePanel.test.tsx`**

```tsx
import { describe, it, expect, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { TunePanel } from './TunePanel'

const VOICES = ['banmai', 'thuminh', 'lannhi', 'linhsan', 'leminh', 'giahuy', 'myan']

describe('TunePanel', () => {
  it('renders voice select with all 7 options', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const select = screen.getByRole('combobox', { name: /voice/i })
    expect(select).toBeDefined()
    for (const v of VOICES) {
      expect(screen.getByText(new RegExp(v, 'i'))).toBeDefined()
    }
  })

  it('renders speed slider', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    expect(screen.getByRole('slider', { name: /speed/i })).toBeDefined()
  })

  it('is read-only when disabled=true', () => {
    render(<TunePanel projectId="p1" disabled={true} />)
    const select = screen.getByRole('combobox', { name: /voice/i })
    expect((select as HTMLSelectElement).disabled).toBe(true)
  })

  it('renders file upload dropzone', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    expect(screen.getByTestId('asset-dropzone')).toBeDefined()
  })
})
```

- [ ] **Step 3: Run — verify FAIL**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test --test-name-pattern "TunePanel"
```

- [ ] **Step 4: Create `frontend/src/components/TunePanel.tsx`**

```tsx
import { useState, useRef } from 'react'
import { useVidgenStore, type TuneInput, type UploadedAsset } from '../store/store'

const VOICES: Array<{ id: string; label: string }> = [
  { id: 'banmai', label: 'banmai — northern female' },
  { id: 'thuminh', label: 'thuminh — northern female' },
  { id: 'lannhi', label: 'lannhi — southern female' },
  { id: 'linhsan', label: 'linhsan — southern female' },
  { id: 'leminh', label: 'leminh — northern male' },
  { id: 'giahuy', label: 'giahuy — central male' },
  { id: 'myan', label: 'myan — central female' },
]

interface TunePanelProps {
  projectId: string
  disabled: boolean
}

export function TunePanel({ projectId, disabled }: TunePanelProps) {
  const style = useVidgenStore((s) => s.projects[projectId]?.style)
  const tuneProject = useVidgenStore((s) => s.tuneProject)
  const uploadAssets = useVidgenStore((s) => s.uploadAssets)
  const fetchAssets = useVidgenStore((s) => s.fetchAssets)

  const [assets, setAssets] = useState<UploadedAsset[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cur = style ?? { voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null }

  async function handleTuneChange(patch: Partial<TuneInput>) {
    if (disabled) return
    await tuneProject({ projectId, ...patch })
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0 || disabled) return
    setUploading(true)
    try {
      await uploadAssets(projectId, Array.from(files))
      const updated = await fetchAssets(projectId)
      setAssets(updated)
    } finally {
      setUploading(false)
    }
  }

  return (
    <section className="vg-tune-panel" aria-label="Project tune settings">
      <div className="vg-tune-panel__field">
        <label htmlFor={`voice-${projectId}`}>Voice</label>
        <select
          id={`voice-${projectId}`}
          value={cur.voice}
          disabled={disabled}
          onChange={(e) => handleTuneChange({ voice: e.target.value })}
          aria-label="voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`speed-${projectId}`}>Speed ({cur.speed})</label>
        <input
          id={`speed-${projectId}`}
          type="range"
          min={-3}
          max={3}
          step={1}
          value={cur.speed}
          disabled={disabled}
          onChange={(e) => handleTuneChange({ speed: Number(e.target.value) })}
          aria-label="speed"
        />
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`font-${projectId}`}>Caption font</label>
        <input
          id={`font-${projectId}`}
          type="text"
          value={cur.captionStyle.fontName}
          disabled={disabled}
          onBlur={(e) => handleTuneChange({ captionStyle: { ...cur.captionStyle, fontName: e.target.value } })}
          onChange={() => {}}
          aria-label="caption font name"
        />
        <input
          type="number"
          value={cur.captionStyle.fontSize}
          min={8}
          max={200}
          disabled={disabled}
          onBlur={(e) => handleTuneChange({ captionStyle: { ...cur.captionStyle, fontSize: Number(e.target.value) } })}
          onChange={() => {}}
          aria-label="caption font size"
        />
      </div>

      <div className="vg-tune-panel__field">
        <label htmlFor={`music-search-${projectId}`}>Music search</label>
        <input
          id={`music-search-${projectId}`}
          type="text"
          placeholder="e.g. upbeat acoustic"
          value={cur.music?.search ?? ''}
          disabled={disabled}
          onBlur={(e) => {
            const val = e.target.value.trim()
            handleTuneChange({ music: val ? { search: val, volume: cur.music?.volume ?? 0.3 } : null })
          }}
          onChange={() => {}}
        />
        {cur.music && (
          <input
            type="range"
            min={0.01}
            max={1}
            step={0.01}
            value={cur.music.volume}
            disabled={disabled}
            onChange={(e) => handleTuneChange({ music: { ...cur.music!, volume: Number(e.target.value) } })}
            aria-label="music volume"
          />
        )}
      </div>

      <div className="vg-tune-panel__field" data-testid="asset-dropzone">
        <label>Local assets (uploaded in scene order)</label>
        <input
          ref={fileRef}
          type="file"
          accept=".mp4,.mov,.jpg,.jpeg,.png"
          multiple
          disabled={disabled || uploading}
          onChange={(e) => handleFiles(e.target.files)}
          aria-label="upload local assets"
        />
        {assets.length > 0 && (
          <ul className="vg-tune-panel__assets">
            {assets.map((a) => (
              <li key={a.filename}>{a.filename} ({Math.round(a.sizeBytes / 1024)} KB)</li>
            ))}
          </ul>
        )}
        {uploading && <span>Uploading…</span>}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Run tests — verify PASS**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test --test-name-pattern "TunePanel"
```

- [ ] **Step 6: Add TunePanel to `frontend/src/components/ProjectCard.tsx`**

```tsx
import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { SceneStrip } from './SceneStrip'
import { StoryboardApproval } from './StoryboardApproval'
import { TunePanel } from './TunePanel'

interface ProjectCardProps {
  projectId: string
}

export function ProjectCard({ projectId }: ProjectCardProps) {
  const status = useVidgenStore((state) => state.projects[projectId]?.status)
  const select = useVidgenStore((state) => state.select)

  if (!status) {
    return null
  }

  const tuneDisabled = !['draft', 'scripted', 'material', 'awaiting_approval'].includes(status)

  return (
    <article className="vg-project-card" data-testid={`project-card-${projectId}`}>
      <header>
        <h2>{projectId}</h2>
        <span>{status}</span>
        <CostBadge projectId={projectId} />
      </header>
      <button type="button" onClick={() => select(projectId)}>
        Select
      </button>
      <TunePanel projectId={projectId} disabled={tuneDisabled} />
      <SceneStrip projectId={projectId} />
      <StoryboardApproval projectId={projectId} />
    </article>
  )
}
```

- [ ] **Step 7: Run all frontend tests**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test
```

- [ ] **Step 8: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add frontend/src/components/TunePanel.tsx frontend/src/components/TunePanel.test.tsx \
        frontend/src/components/ProjectCard.tsx
git commit -m "feat(ui): TunePanel — voice/speed/caption/music/asset upload controls"
```

---

## Task 11 — E2E gate (docker + browser-only render)

**Purpose:** Verify the E2E pipeline works before CLI deletion. Direct reads against the world — not task completion.

- [ ] **Step 1: Build and start docker stack in p5 worktree**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
docker compose build
docker compose up -d
```

Wait ~10 s for services to start.

- [ ] **Step 2: Open browser and create project**

Open `http://localhost:8080`. Create a project with short idea, 1–2 scenes, 15–20 sec. Verify `ProjectCreated` event in NATS (optional: `docker compose exec nats nats stream view VIDGEN_EVENTS --count 5`).

- [ ] **Step 3: Generate script, set tune**

Click GenerateScript. When `scripted`, use TunePanel to set a non-default voice (e.g. `lannhi`, speed=1). Verify `StyleSet` event emitted.

- [ ] **Step 4: Upload one local asset**

Use the TunePanel dropzone to upload a local .mp4 or .jpg. Verify `POST /api/projects/:id/assets` returns 200.

- [ ] **Step 5: Resolve material, generate voiceovers**

Click ResolveMaterial (local asset should appear as scene 0's material). Click GenerateVoiceovers.

**Verify job payloads directly** — subscribe to NATS jobs stream and check TTS payload carries the chosen voice/speed:

```bash
docker compose exec nats nats stream view VIDGEN_JOBS --count 20 2>&1 | grep -A 5 '"type":"tts"'
```

Expected: `"voice":"lannhi"` and `"speed":1` in the TTS job payload.

Verify MaterialResolved has `source: "local"`:

```bash
docker compose exec nats nats stream view VIDGEN_EVENTS 2>&1 | grep -A 3 "MaterialResolved"
```

- [ ] **Step 6: Request approval, approve, wait for render**

Click RequestApproval → ApproveStoryboard. Wait for `RenderCompleted` event (worker runs ffmpeg — may take 30–120 s). Verify `outputPath` exists on the media volume:

```bash
docker compose exec worker ls /app/media/
```

- [ ] **Step 7: Verify cost ≤ cap**

```bash
docker compose exec postgres psql -U vidgen -d vidgen -c "SELECT project_id, spent_usd FROM projects;"
```

Expected: `spent_usd` ≤ `0.15` (or configured COST_CAP_USD).

- [ ] **Step 8: Record E2E pass**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git commit --allow-empty -m "ci: E2E gate passed — browser render, source=local, lannhi voice in TTS payload, cost within cap"
```

- [ ] **Step 9: Stop docker stack**

```bash
docker compose down
```

---

## Task 12 — CLI deletion

**Pre-condition:** E2E gate (Task 11) must have passed.

- [ ] **Step 1: Identify root packages used ONLY by the CLI**

```bash
ls /Users/cuongtran/Kanna/video-generation-skill-p5/cmd/
ls /Users/cuongtran/Kanna/video-generation-skill-p5/internal/
```

All packages under the root module's `cmd/` and `internal/` exist only for the legacy Go CLI. The worker is its own Go module at `worker/go.mod` and imports nothing from the root module. Verify:

```bash
grep -r "github.com/cuongtranba/video-generation-skill\"" \
  /Users/cuongtran/Kanna/video-generation-skill-p5/worker/ 2>/dev/null | head
```

Expected: no matches (worker uses its own module path `github.com/cuongtranba/video-generation-skill/worker`).

- [ ] **Step 2: Delete root Go CLI packages**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
rm -rf cmd/ internal/ go.mod go.sum
```

- [ ] **Step 3: Verify worker still builds and tests pass**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/worker
go build ./...
go test ./internal/jobhandler/... ./internal/render/...
go vet ./...
```

Expected: clean build + tests pass.

- [ ] **Step 4: Verify api and frontend tests still pass**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add -A
git commit -m "feat(p5): delete legacy Go CLI (cmd/, root internal/, root go.mod/go.sum)"
```

---

## Task 13 — README + CLAUDE.md sync + C3 change-unit

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- C3 change-unit: `adr-20260709-webapp-topology`

- [ ] **Step 1: Update README.md**

Remove all references to CLI usage (`vidgen generate`, `vidgen tune`, `--resource`, cobra commands). Replace with webapp-only usage section:

```markdown
## Usage

Start the stack:
```
docker compose up
```

Open http://localhost:8080 in your browser.

1. **Create project** — enter idea, duration, scene count, tone
2. **Generate script** — AI writes scene narrations + visuals
3. **Tune** — pick voice, speed, captions, music, upload local media
4. **Resolve material** — stock video/photo pulled per scene (local assets used first)
5. **Generate voiceovers** — FPT.AI TTS synthesizes narration (cost checked against cap)
6. **Approve** — review cost projection and storyboard
7. **Render** — ffmpeg assembles final 9:16 video
```

- [ ] **Step 2: Update CLAUDE.md**

Remove the `Commands` section referencing `go build -o vidgen ./cmd/vidgen`. Replace with:

```markdown
## Commands

```bash
# worker
cd worker && go build ./...        # build worker
cd worker && go test ./internal/jobhandler/... ./internal/render/...  # targeted unit tests
cd worker && go vet ./...

# api
cd api && bun test                 # unit tests
cd api && bun run typecheck

# frontend
cd frontend && bun test
```
```

- [ ] **Step 3: Run C3 change-unit**

```
/c3 change
```

Follow the C3 skill to create change-unit `adr-20260709-webapp-topology` covering:
- Contract change: `StyleSet` event + `TuneProject` command added
- Topology change: root Go module removed; system is now api (bun) + worker (Go) + frontend (Vite) + NATS + Postgres

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
git add README.md CLAUDE.md .c3/
git commit -m "docs: webapp-only README + CLAUDE.md; C3 adr-20260709-webapp-topology"
```

---

## Task 14 — PR

- [ ] **Step 1: Final test sweep**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5/api && bun test
cd /Users/cuongtran/Kanna/video-generation-skill-p5/frontend && bun test
cd /Users/cuongtran/Kanna/video-generation-skill-p5/worker && go test ./internal/jobhandler/... ./internal/render/... && go vet ./...
```

All must be green before opening PR.

- [ ] **Step 2: Open PR**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill-p5
gh pr create \
  --title "P5: resource+tune parity + CLI removal" \
  --body "$(cat <<'EOF'
## Summary
- Adds `StyleSet` event + `TuneProject` command (the one ratified contract change): voice, speed, caption style, music, local asset upload
- Fixes all worker job payloads (voice/speed in TTS, style in caption, music in render, localAssetPath in material)
- Wires Jamendo music source into render worker
- New TunePanel UI component with voice select, speed slider, caption controls, music search, asset dropzone
- E2E gate passed: browser-only render with source=local + non-default voice confirmed in NATS job payloads
- Deletes `cmd/vidgen`, `internal/` (root), root `go.mod`/`go.sum` (legacy CLI)
- README + CLAUDE.md webapp-only docs; C3 change-unit `adr-20260709-webapp-topology`

## Test plan
- [ ] `cd api && bun test` — green
- [ ] `cd frontend && bun test` — green
- [ ] `cd worker && go test ./internal/jobhandler/... ./internal/render/...` — green
- [ ] `cd worker && go vet ./...` — clean
- [ ] Docker E2E: `docker compose up`, create project, tune, upload local asset, render, verify cost ≤ cap
- [ ] Confirm `MaterialResolved{source:"local"}` in NATS events for uploaded asset
- [ ] Confirm TTS job payload contains chosen voice/speed
EOF
)"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Task covering it |
|---|---|
| `TuneProject` cmd + `StyleSet` event | Tasks 1–5 |
| Msg-id per-emission uid | Task 2 |
| Upload endpoint + list | Task 6 |
| Material assignment (localAssetPath) | Tasks 6, 8 |
| Payload filling (voice/speed/style/music) | Task 4 |
| Worker music resolution (Jamendo) | Task 8 |
| Fold `style` into `ProjectState` | Task 1 |
| Projection `style` column | Tasks 3, 5 |
| TunePanel UI (impeccable) | Task 10 |
| E2E gate (docker, direct reads) | Task 11 |
| CLI deletion | Task 12 |
| Docs + C3 change-unit | Task 13 |
| `mediaDir` in CommandContext | Task 7 |
| `ValidationError` → 400 | Task 6 |

**Pointless-trap check:** Tasks 4 (payload filling) and 8 (music resolution) together close the gap. E2E Task 11 Step 5 does a direct NATS payload inspection — not "tests passed" cascade.

**Cost wall:** `generateVoiceovers` in Task 4 is copied verbatim with `admit()` check intact. `renderUsd = 0` unchanged in worker. No cost code modified.

**Type consistency:**
- `StyleSpec` defined in `events.ts`, imported in `commands.ts`, `projections.ts`, `http.ts`
- `TuneInput.music?: ... | null` — `'music' in input` pattern used throughout to distinguish "omitted" from explicit null
- `RenderMusicJob.Search` (Go) matches `renderJob.music.search` (TS dispatch) via `json:"search"` tag
- `DEFAULT_STYLE` exported from `events.ts`, used in `foldProject` init and test assertions
