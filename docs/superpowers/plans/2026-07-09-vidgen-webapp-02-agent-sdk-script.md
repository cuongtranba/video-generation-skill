# P2 — Agent SDK Script Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `api/src/script.ts` — a pure prompt/schema layer plus a Claude Agent SDK-backed `generateScenes()` call that turns `{ idea, durationSec, sceneCount, tone }` into `{ scenes: Scene[], notionalUsd: number }`, and a pure mapper that turns that result into the frozen `ScriptGenerated` event with `scriptUsd` hard-pinned to `0`.

**Architecture:** One new module, `api/src/script.ts`, inside the `api` TypeScript service (built by P1). Four pure/impure layers in the same file, added incrementally: (1) `ScriptInput`/`ScriptResult`/`ScriptGeneratedMapping` types + the JSON schema + Vietnamese prompt builder (pure), (2) `parseScenes` — structured-output → `Scene[]` with `idx` assigned by array position (pure), (3) `mapScriptGeneratedEvent` — result → `{ event, notionalUsd }` with the BINDING `scriptUsd = 0` rule (pure), (4) `generateScenes` — calls `query()` from `@anthropic-ai/claude-agent-sdk`, reads `total_cost_usd` + `structured_output` off the terminal `result` message (impure, SDK-backed). Only layer 4 talks to the SDK/CLI; layers 1–3 are unit-tested with zero I/O. One opt-in, env-gated live test exercises layer 4 end-to-end against the local `claude` CLI (subscription auth — no API key).

**Tech Stack:** TypeScript (ESM, Node), `@anthropic-ai/claude-agent-sdk@^0.3.205` (version verified working in `spikes/agent-sdk/script-cost.ts` and cross-checked against Context7 docs below), `vitest` for tests (matches the `spikes/event-model` precedent already in this repo).

---

## Ground truth this plan is bound by

- `docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md` — §3 (target layout: `api/src/script.ts`), §4 (frozen `Scene`/`VidgenEvent` shapes, event id scheme), §5 (`GenerateScript` command contract), §6 (frozen cost rule), §7 (frozen Agent SDK import shape).
- `spikes/agent-sdk/script-cost.ts` — verified working `query()` call shape (prompt + `outputFormat: { type: 'json_schema', schema }`, read `total_cost_usd` + `structured_output` off `message.type === 'result'`).
- `.okra/runs/disc-01/checkpoints/D1.md` — **BINDING**: `total_cost_usd` is a *notional* telemetry number computed from list-price token rates; under the Claude Max subscription used to auth `query()`, the real marginal cost of a script-gen call is $0. The webapp's enforced cost ledger must NOT sum `total_cost_usd`. Confirmed 3/3 ideas produced valid `structured_output.scenes`.
- `spikes/event-model/events.ts` — frozen `Scene = { idx: number; narration: string; visual: string }` and the `ScriptGenerated` event variant `{ v: 1; type: 'ScriptGenerated'; projectId: string; at: string; scenes: Scene[]; scriptUsd: number }`. **Promoted verbatim to `api/src/events.ts` by P1 — this plan imports from there and does not alter it.**

**Context7 verification (per project CLAUDE.md rule "fetch current docs before writing code that uses a library"):** resolved `@anthropic-ai/claude-agent-sdk` via Context7 (`/nothflare/claude-agent-sdk-docs`) and queried the structured-output + result-message docs. Confirmed the exact shape used below:
- `query({ prompt, options: { outputFormat: { type: 'json_schema', schema } } })` — async generator of messages.
- Only `message.type === 'result'` carries the final answer. Its TS type (`SDKResultMessage`) is a discriminated union on `subtype`:
  - `subtype: 'success'` → has `structured_output?: unknown`, `total_cost_usd: number`, `usage`, `modelUsage`, `result: string`.
  - `subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries'` → has `total_cost_usd: number` and `errors: string[]`, **no** `structured_output`.
- `structured_output` is typed `unknown` by the SDK — this plan narrows it at runtime in `parseScenes` (never casts blindly), satisfying the "no `any`/`unknown` unless narrowed" rule.

**BINDING rule this plan enforces (from D1, restated):** `generateScenes()` returns the SDK's `total_cost_usd` as `notionalUsd` for observability only. `mapScriptGeneratedEvent()` always sets the emitted event's `scriptUsd` to the literal `0`. `notionalUsd` is returned alongside the event for the caller to log — it is never written into the event (the event shape is frozen and has no field for it) and never enters the enforced cost ledger.

---

## Assumed pre-existing state (produced by P1 — not created by this plan)

This plan is written to execute **after** P1. It assumes, per the index's §3 target layout:
- `api/package.json`, `api/tsconfig.json` exist, `"type": "module"`, ESM + `.js`-suffixed relative imports (same convention as `spikes/event-model`).
- `api/src/events.ts` exists and exports `Scene`, `VidgenEvent`, `foldProject`, `ProjectState` — promoted verbatim from `spikes/event-model/events.ts` (read above; do not re-derive or alter it here).
- `vitest` is already a devDependency and picks up `src/**/*.test.ts` by default (same pattern as `spikes/event-model/vitest.config.ts`).

If any of these are missing when this plan is executed, stop and flag it — that is a P1 gap, not something to patch inside a P2 task.

---

### Task 1: Types, JSON schema, and the Vietnamese prompt builder

**Files:**
- Create: `api/src/script.ts`
- Create: `api/src/script.test.ts`

- [ ] **Step 1: Add the Agent SDK dependency**

Run (from repo root):
```bash
cd api && npm install @anthropic-ai/claude-agent-sdk@^0.3.205
```
Expected: `package.json` and `package-lock.json` in `api/` gain the `@anthropic-ai/claude-agent-sdk` entry. (Pinned to the version already verified working in `spikes/agent-sdk/package.json`.)

- [ ] **Step 2: Write the failing test for the prompt builder and schema**

Create `api/src/script.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, scriptSchema, type ScriptInput } from './script.js'

describe('buildScriptPrompt', () => {
  it('includes idea, duration, scene count, and tone in the Vietnamese prompt', () => {
    const input: ScriptInput = { idea: '3 lý do bạn nên uống nước ấm mỗi sáng', durationSec: 30, sceneCount: 3, tone: 'casual' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('30 giây')
    expect(prompt).toContain('3 cảnh')
    expect(prompt).toContain('3 lý do bạn nên uống nước ấm mỗi sáng')
    expect(prompt).toContain('casual')
  })

  it('reflects a different duration, scene count, and tone', () => {
    const input: ScriptInput = { idea: '5 mẹo tiết kiệm pin điện thoại', durationSec: 45, sceneCount: 5, tone: 'energetic' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('45 giây')
    expect(prompt).toContain('5 cảnh')
    expect(prompt).toContain('energetic')
  })
})

describe('scriptSchema', () => {
  it('requires a scenes array with narration and visual per item', () => {
    expect(scriptSchema.required).toEqual(['scenes'])
    expect(scriptSchema.properties.scenes.items.required).toEqual(['narration', 'visual'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: FAIL — `api/src/script.ts` does not exist yet, so the import of `./script.js` cannot be resolved (e.g. `Error: Cannot find module '.../api/src/script.ts' imported from '.../api/src/script.test.ts'`).

- [ ] **Step 4: Implement the types, schema, and prompt builder**

Create `api/src/script.ts`:

```typescript
import type { Scene, VidgenEvent } from './events.js'

export type ScriptInput = {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
}

export type ScriptResult = {
  scenes: Scene[]
  notionalUsd: number
}

export type ScriptGeneratedMapping = {
  event: Extract<VidgenEvent, { type: 'ScriptGenerated' }>
  notionalUsd: number
}

export const scriptSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          narration: { type: 'string' },
          visual: { type: 'string' },
        },
        required: ['narration', 'visual'],
      },
    },
  },
  required: ['scenes'],
} as const

export function buildScriptPrompt(input: ScriptInput): string {
  return `Viết kịch bản video dọc ${input.durationSec} giây (${input.sceneCount} cảnh) cho ý tưởng: "${input.idea}". Giọng điệu: ${input.tone}. Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual). Trả về đúng ${input.sceneCount} cảnh, không nhiều hơn hoặc ít hơn.`
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: PASS
```
✓ src/script.test.ts (3 tests)

Test Files  1 passed (1)
     Tests  3 passed (3)
```

- [ ] **Step 6: Commit**

```bash
cd api && git add package.json package-lock.json src/script.ts src/script.test.ts
git commit -m "feat(api): add script prompt builder and scene JSON schema"
```

---

### Task 2: Structured-output → `Scene[]` parsing (with `idx` by array position)

**Files:**
- Modify: `api/src/script.ts`
- Modify: `api/src/script.test.ts`

- [ ] **Step 1: Write the failing tests for `parseScenes`**

Replace the full contents of `api/src/script.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, parseScenes, scriptSchema, type ScriptInput } from './script.js'

describe('buildScriptPrompt', () => {
  it('includes idea, duration, scene count, and tone in the Vietnamese prompt', () => {
    const input: ScriptInput = { idea: '3 lý do bạn nên uống nước ấm mỗi sáng', durationSec: 30, sceneCount: 3, tone: 'casual' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('30 giây')
    expect(prompt).toContain('3 cảnh')
    expect(prompt).toContain('3 lý do bạn nên uống nước ấm mỗi sáng')
    expect(prompt).toContain('casual')
  })

  it('reflects a different duration, scene count, and tone', () => {
    const input: ScriptInput = { idea: '5 mẹo tiết kiệm pin điện thoại', durationSec: 45, sceneCount: 5, tone: 'energetic' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('45 giây')
    expect(prompt).toContain('5 cảnh')
    expect(prompt).toContain('energetic')
  })
})

describe('scriptSchema', () => {
  it('requires a scenes array with narration and visual per item', () => {
    expect(scriptSchema.required).toEqual(['scenes'])
    expect(scriptSchema.properties.scenes.items.required).toEqual(['narration', 'visual'])
  })
})

describe('parseScenes', () => {
  it('maps valid structured output to Scene[] with idx assigned by array position', () => {
    const scenes = parseScenes({
      scenes: [
        { narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
        { narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
      ],
    })
    expect(scenes).toEqual([
      { idx: 0, narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
      { idx: 1, narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
    ])
  })

  it('throws when structured output is not an object', () => {
    expect(() => parseScenes(undefined)).toThrow(/expected object/)
  })

  it('throws when "scenes" is missing or not an array', () => {
    expect(() => parseScenes({})).toThrow(/expected "scenes" to be an array/)
  })

  it('throws when a scene item is missing narration or visual', () => {
    expect(() => parseScenes({ scenes: [{ visual: 'chỉ có visual' }] })).toThrow(/missing narration/)
    expect(() => parseScenes({ scenes: [{ narration: 'chỉ có narration' }] })).toThrow(/missing visual/)
  })
})
```

This is the complete file — it replaces the Task 1 version wholesale (adds `parseScenes` to the `./script.js` import and appends the new `describe` block).

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: FAIL — `parseScenes` is not exported from `./script.js` (`SyntaxError: The requested module './script.js' does not provide an export named 'parseScenes'`), while the 3 Task 1 tests still pass.

- [ ] **Step 3: Implement `parseScenes`**

Append to `api/src/script.ts` (after `buildScriptPrompt`):

```typescript
export function parseScenes(structuredOutput: unknown): Scene[] {
  if (typeof structuredOutput !== 'object' || structuredOutput === null) {
    throw new Error(`parseScenes: expected object, got ${typeof structuredOutput}`)
  }
  const raw = structuredOutput as Record<string, unknown>
  const scenesField = raw.scenes
  if (!Array.isArray(scenesField)) {
    throw new Error('parseScenes: expected "scenes" to be an array')
  }
  return scenesField.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`parseScenes: scene ${idx} is not an object`)
    }
    const { narration, visual } = item as Record<string, unknown>
    if (typeof narration !== 'string' || narration.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing narration`)
    }
    if (typeof visual !== 'string' || visual.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing visual`)
    }
    return { idx, narration, visual }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: PASS
```
✓ src/script.test.ts (7 tests)

Test Files  1 passed (1)
     Tests  7 passed (7)
```

- [ ] **Step 5: Commit**

```bash
cd api && git add src/script.ts src/script.test.ts
git commit -m "feat(api): parse SDK structured output into Scene[] with positional idx"
```

---

### Task 3: `mapScriptGeneratedEvent` — the BINDING `scriptUsd = 0` rule

**Files:**
- Modify: `api/src/script.ts`
- Modify: `api/src/script.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the full contents of `api/src/script.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, mapScriptGeneratedEvent, parseScenes, scriptSchema, type ScriptInput } from './script.js'
import type { Scene } from './events.js'

describe('buildScriptPrompt', () => {
  it('includes idea, duration, scene count, and tone in the Vietnamese prompt', () => {
    const input: ScriptInput = { idea: '3 lý do bạn nên uống nước ấm mỗi sáng', durationSec: 30, sceneCount: 3, tone: 'casual' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('30 giây')
    expect(prompt).toContain('3 cảnh')
    expect(prompt).toContain('3 lý do bạn nên uống nước ấm mỗi sáng')
    expect(prompt).toContain('casual')
  })

  it('reflects a different duration, scene count, and tone', () => {
    const input: ScriptInput = { idea: '5 mẹo tiết kiệm pin điện thoại', durationSec: 45, sceneCount: 5, tone: 'energetic' }
    const prompt = buildScriptPrompt(input)
    expect(prompt).toContain('45 giây')
    expect(prompt).toContain('5 cảnh')
    expect(prompt).toContain('energetic')
  })
})

describe('scriptSchema', () => {
  it('requires a scenes array with narration and visual per item', () => {
    expect(scriptSchema.required).toEqual(['scenes'])
    expect(scriptSchema.properties.scenes.items.required).toEqual(['narration', 'visual'])
  })
})

describe('parseScenes', () => {
  it('maps valid structured output to Scene[] with idx assigned by array position', () => {
    const scenes = parseScenes({
      scenes: [
        { narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
        { narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
      ],
    })
    expect(scenes).toEqual([
      { idx: 0, narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
      { idx: 1, narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
    ])
  })

  it('throws when structured output is not an object', () => {
    expect(() => parseScenes(undefined)).toThrow(/expected object/)
  })

  it('throws when "scenes" is missing or not an array', () => {
    expect(() => parseScenes({})).toThrow(/expected "scenes" to be an array/)
  })

  it('throws when a scene item is missing narration or visual', () => {
    expect(() => parseScenes({ scenes: [{ visual: 'chỉ có visual' }] })).toThrow(/missing narration/)
    expect(() => parseScenes({ scenes: [{ narration: 'chỉ có narration' }] })).toThrow(/missing visual/)
  })
})

describe('mapScriptGeneratedEvent', () => {
  it('always sets the event scriptUsd to 0 and keeps notionalUsd separate', () => {
    const scenes: Scene[] = [{ idx: 0, narration: 'Xin chào', visual: 'cảnh mở đầu' }]
    const mapping = mapScriptGeneratedEvent('p1', '2026-07-09T00:00:00Z', { scenes, notionalUsd: 0.214275 })

    expect(mapping.event).toEqual({
      v: 1,
      type: 'ScriptGenerated',
      projectId: 'p1',
      at: '2026-07-09T00:00:00Z',
      scenes,
      scriptUsd: 0,
    })
    expect(mapping.notionalUsd).toBeCloseTo(0.214275)
  })

  it('sets scriptUsd to 0 even when notionalUsd is 0', () => {
    const mapping = mapScriptGeneratedEvent('p2', '2026-07-09T00:00:00Z', { scenes: [], notionalUsd: 0 })
    expect(mapping.event.scriptUsd).toBe(0)
    expect(mapping.notionalUsd).toBe(0)
  })
})
```

This is the complete file — it replaces the Task 2 version wholesale (adds `mapScriptGeneratedEvent` to the `./script.js` import, adds the `./events.js` type import, and appends the new `describe` block). It does not change again in Task 4 — only `script.live.test.ts` is added there.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: FAIL — `mapScriptGeneratedEvent` is not exported from `./script.js`, while the 7 existing tests still pass.

- [ ] **Step 3: Implement `mapScriptGeneratedEvent`**

Append to `api/src/script.ts` (after `parseScenes`):

```typescript
export function mapScriptGeneratedEvent(projectId: string, at: string, result: ScriptResult): ScriptGeneratedMapping {
  return {
    event: { v: 1, type: 'ScriptGenerated', projectId, at, scenes: result.scenes, scriptUsd: 0 },
    notionalUsd: result.notionalUsd,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd api && npx vitest run src/script.test.ts
```
Expected: PASS
```
✓ src/script.test.ts (9 tests)

Test Files  1 passed (1)
     Tests  9 passed (9)
```

- [ ] **Step 5: Commit**

```bash
cd api && git add src/script.ts src/script.test.ts
git commit -m "feat(api): map script result to ScriptGenerated event, scriptUsd pinned to 0"
```

---

### Task 4: `generateScenes` (Agent SDK call) + opt-in live integration test

**Files:**
- Modify: `api/src/script.ts`
- Create: `api/src/script.live.test.ts`

- [ ] **Step 1: Write the live integration test (env-gated, budgeted to 1 SDK call)**

Create `api/src/script.live.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { generateScenes, mapScriptGeneratedEvent } from './script.js'

// Live test: spawns the local `claude` CLI via the Agent SDK, authenticated by the
// machine's Claude subscription (OAuth/keychain) — NO ANTHROPIC_API_KEY is used or
// required. Budget: 1 SDK call (of the ≤2 allowed). Skipped by default.
//
// Run explicitly with:
//   cd api && RUN_LIVE_SDK_TESTS=1 npx vitest run src/script.live.test.ts
describe.skipIf(!process.env.RUN_LIVE_SDK_TESTS)('generateScenes (live)', () => {
  it('produces sceneCount scenes and maps to scriptUsd = 0', async () => {
    const input = { idea: '3 lý do bạn nên uống nước ấm mỗi sáng', durationSec: 30, sceneCount: 3, tone: 'casual' }

    const result = await generateScenes(input)

    expect(result.scenes.length).toBe(input.sceneCount)
    for (const scene of result.scenes) {
      expect(scene.narration.length).toBeGreaterThan(0)
      expect(scene.visual.length).toBeGreaterThan(0)
    }
    expect(result.notionalUsd).toBeGreaterThanOrEqual(0)

    const mapping = mapScriptGeneratedEvent('live-test-project', new Date().toISOString(), result)
    expect(mapping.event.scriptUsd).toBe(0)
    expect(mapping.event.scenes).toEqual(result.scenes)
    expect(mapping.notionalUsd).toBe(result.notionalUsd)
  }, 120_000)
})
```

- [ ] **Step 2: Implement `generateScenes` immediately**

`script.live.test.ts` imports `generateScenes`, a named export that doesn't exist until this step — under Node ESM that import fails to resolve at load time (not a clean "test skipped," a load error), so there is no useful intermediate red/green checkpoint here the way there was in Tasks 1–3. Implement directly, then verify in Step 3.

Modify `api/src/script.ts` — add the SDK import at the top and append `generateScenes` after `mapScriptGeneratedEvent`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Scene, VidgenEvent } from './events.js'
```

```typescript
export async function generateScenes(input: ScriptInput): Promise<ScriptResult> {
  const prompt = buildScriptPrompt(input)
  let result: ScriptResult | undefined

  for await (const message of query({
    prompt,
    options: { outputFormat: { type: 'json_schema', schema: scriptSchema } },
  })) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`generateScenes: SDK query failed (${message.subtype}): ${message.errors.join('; ')}`)
      }
      const scenes = parseScenes(message.structured_output)
      result = { scenes, notionalUsd: message.total_cost_usd }
    }
  }

  if (!result) {
    throw new Error('generateScenes: SDK query produced no result message')
  }
  return result
}
```

The full `api/src/script.ts` after this step (canonical reference — import ordering matters for ESM):

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Scene, VidgenEvent } from './events.js'

export type ScriptInput = {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
}

export type ScriptResult = {
  scenes: Scene[]
  notionalUsd: number
}

export type ScriptGeneratedMapping = {
  event: Extract<VidgenEvent, { type: 'ScriptGenerated' }>
  notionalUsd: number
}

export const scriptSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          narration: { type: 'string' },
          visual: { type: 'string' },
        },
        required: ['narration', 'visual'],
      },
    },
  },
  required: ['scenes'],
} as const

export function buildScriptPrompt(input: ScriptInput): string {
  return `Viết kịch bản video dọc ${input.durationSec} giây (${input.sceneCount} cảnh) cho ý tưởng: "${input.idea}". Giọng điệu: ${input.tone}. Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual). Trả về đúng ${input.sceneCount} cảnh, không nhiều hơn hoặc ít hơn.`
}

export function parseScenes(structuredOutput: unknown): Scene[] {
  if (typeof structuredOutput !== 'object' || structuredOutput === null) {
    throw new Error(`parseScenes: expected object, got ${typeof structuredOutput}`)
  }
  const raw = structuredOutput as Record<string, unknown>
  const scenesField = raw.scenes
  if (!Array.isArray(scenesField)) {
    throw new Error('parseScenes: expected "scenes" to be an array')
  }
  return scenesField.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`parseScenes: scene ${idx} is not an object`)
    }
    const { narration, visual } = item as Record<string, unknown>
    if (typeof narration !== 'string' || narration.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing narration`)
    }
    if (typeof visual !== 'string' || visual.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing visual`)
    }
    return { idx, narration, visual }
  })
}

export function mapScriptGeneratedEvent(projectId: string, at: string, result: ScriptResult): ScriptGeneratedMapping {
  return {
    event: { v: 1, type: 'ScriptGenerated', projectId, at, scenes: result.scenes, scriptUsd: 0 },
    notionalUsd: result.notionalUsd,
  }
}

export async function generateScenes(input: ScriptInput): Promise<ScriptResult> {
  const prompt = buildScriptPrompt(input)
  let result: ScriptResult | undefined

  for await (const message of query({
    prompt,
    options: { outputFormat: { type: 'json_schema', schema: scriptSchema } },
  })) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`generateScenes: SDK query failed (${message.subtype}): ${message.errors.join('; ')}`)
      }
      const scenes = parseScenes(message.structured_output)
      result = { scenes, notionalUsd: message.total_cost_usd }
    }
  }

  if (!result) {
    throw new Error('generateScenes: SDK query produced no result message')
  }
  return result
}
```

- [ ] **Step 3: Run the default (pure) suite — still green, live test still skipped**

Run:
```bash
cd api && npx vitest run
```
Expected:
```
✓ src/script.test.ts (9 tests)
↓ src/script.live.test.ts (1 test | 1 skipped)

Test Files  2 passed (2)
     Tests  9 passed | 1 skipped (10)
```

- [ ] **Step 4: Type-check the module**

Run:
```bash
cd api && npx tsc --noEmit
```
Expected: no output, exit code 0. (Confirms `structured_output: unknown` is narrowed correctly in `parseScenes`, `Extract<VidgenEvent, {...}>` resolves, and there are no `any` leaks.)

- [ ] **Step 5: Run the live test once to spend the 1 budgeted SDK call and confirm real behavior**

Run:
```bash
cd api && RUN_LIVE_SDK_TESTS=1 npx vitest run src/script.live.test.ts
```
Expected: PASS, using 1 of the ≤2 budgeted live SDK calls (real `claude` CLI subprocess spawn, no `ANTHROPIC_API_KEY` in the environment):
```
✓ src/script.live.test.ts (1 test)

Test Files  1 passed (1)
     Tests  1 passed (1)
```
If it fails with an auth or "claude CLI not found" error, that is a local-environment prerequisite gap (matches this repo's existing `claude --help` / OAuth setup documented in D1), not a bug in `script.ts` — stop and report rather than working around it.

- [ ] **Step 6: Commit**

```bash
cd api && git add src/script.ts src/script.live.test.ts
git commit -m "feat(api): implement generateScenes via Agent SDK, add opt-in live test"
```

---

## Integration with P1's `GenerateScript` command handler (reference only — no files created or modified by this task)

P1 owns `api/src/commands.ts` and the `GenerateScript` handler (index §5: body `{ projectId }`, appends `ScriptGenerated`). This plan does not touch that file. The seam P1 is expected to define, and how this plan's exports plug into it:

- P1's command-handler factory takes an injected script generator with the shape `(input: ScriptInput) => Promise<ScriptResult>` (both types exported from `api/src/script.ts` above) — constructor/factory injection, consistent with this repo's "DI via constructors, no package-level mutable state" convention.
- P1's bootstrap (`api/src/index.ts`) wires the real implementation: `import { generateScenes } from './script.js'` and passes `scriptGenerator: generateScenes` into that factory. Nothing else in this plan needs to change for that wiring — `generateScenes`'s signature already matches the seam exactly.
- Inside the handler, the expected call sequence is: load/fold the project's events → call `scriptGenerator(scriptInput)` → `mapScriptGeneratedEvent(projectId, nowIso, result)` → append `mapping.event` to `VIDGEN_EVENTS` with `Nats-Msg-Id: ScriptGenerated-<projectId>-` (index §4 id scheme; `ScriptGenerated` is not per-scene, so the scene-idx slot is `-`) → log `mapping.notionalUsd` for observability (it never enters the event stream or the cost ledger — see the BINDING rule above).
- Open dependency for P1, flagged here rather than resolved (out of this plan's scope): the frozen `ProjectState` (from `foldProject`) does **not** carry `idea`/`durationSec`/`sceneCount`/`tone` — only the raw `ProjectCreated` event does. P1's handler needs its own way to source those four fields (e.g. reading the `ProjectCreated` event directly rather than the folded state) before it can build a `ScriptInput` to pass to `scriptGenerator`.
- Testing P1's handler itself (its invariants, idempotency, event append) is P1's responsibility with its own injected stub `scriptGenerator`; this plan's live integration test (Task 4) is what proves the *real* `generateScenes` + `mapScriptGeneratedEvent` chain works end-to-end.

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
|---|---|
| 1. `api/src/script.ts` exporting `generateScenes(input): Promise<{ scenes, notionalUsd }>`, calls `query()` with `outputFormat: json_schema`, reads `structured_output` + `total_cost_usd` off the result message; verified against Context7 | Task 1 (types/schema/prompt), Task 4 (generateScenes) + "Context7 verification" section above |
| 2. BINDING rule: `notionalUsd` observability-only; `ScriptGenerated.scriptUsd = 0`; tests assert scenes validity + `scriptUsd = 0` / `notionalUsd = <sdk value>` kept separate | Task 3 (`mapScriptGeneratedEvent` unit tests), Task 4 Step 1 (live test asserts both) |
| 3. JSON schema maps to `Scene = { idx, narration, visual }`, idx by array position | Task 1 (`scriptSchema`, no `idx` in schema), Task 2 (`parseScenes` assigns `idx`) |
| 4. Prompt builder parameterized by idea/duration/sceneCount/tone, mirrors spike | Task 1 (`buildScriptPrompt`, tested with two different parameter sets) |
| 5. Wire into P1's `GenerateScript` seam; reference only, don't re-specify P1 internals | "Integration with P1" section |
| Testing: pure tests always-run (prompt builder + schema→Scene mapping), no `ANTHROPIC_API_KEY` anywhere, ONE optional live test budgeted ≤2 calls asserting `scenes.length === sceneCount` and `scriptUsd` mapping = 0 | Tasks 1–3 = 9 pure, always-run tests; Task 4 = exactly 1 live test, env-gated, uses 1 of ≤2 budgeted calls, asserts both `scenes.length === sceneCount` and `mapping.event.scriptUsd === 0` |

**2. Placeholder scan:** No "TBD"/"TODO"/"implement later"/"add appropriate error handling" strings anywhere in this plan. Every code block is the complete, final content for that step — `script.test.ts` is given as a full replacement listing at every task that touches it (Tasks 1–3), not an "append this / merge if needed" instruction, and Task 4 Step 2 additionally repeats the full canonical `script.ts` so out-of-order execution can't produce an inconsistent file. The one deliberately-unresolved item (how P1 sources `idea`/`durationSec`/`sceneCount`/`tone` for `ScriptInput`) is explicitly flagged as P1's open dependency, not left as an ambiguous instruction inside a task step.

**3. Type consistency vs. index/events.ts:**
- `Scene = { idx: number; narration: string; visual: string }` used identically in `parseScenes`'s return type and in every test — matches `spikes/event-model/events.ts` verbatim.
- `ScriptGenerated` event literal built in `mapScriptGeneratedEvent` — `{ v: 1; type: 'ScriptGenerated'; projectId; at; scenes; scriptUsd }` — matches the frozen `VidgenEvent` union member field-for-field (including the `v: 1` literal).
- `generateScenes`'s signature (`ScriptInput` → `Promise<ScriptResult>`) is structurally identical to the exact signature requested (`{ idea: string; durationSec: number; sceneCount: number; tone: string } → Promise<{ scenes: Scene[]; notionalUsd: number }>`), just named per this repo's "define explicit types" rule rather than left inline.
- No `any` anywhere. The one `unknown` (in `parseScenes`'s `structuredOutput` parameter, matching the SDK's own `structured_output?: unknown` typing confirmed via Context7) is narrowed via `typeof`/`Array.isArray`/property checks before any field is read — consistent with "no `any`/`unknown` unless narrowed."
- No reference to `ANTHROPIC_API_KEY` anywhere in the plan, code, or test comments — the live test's comment explicitly calls out subscription/OAuth auth instead.
