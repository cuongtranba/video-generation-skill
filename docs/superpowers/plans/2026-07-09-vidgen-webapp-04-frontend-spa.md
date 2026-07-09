# vidgen Webapp Rewrite — P4: React/Zustand SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `frontend/` — a Vite + React + TypeScript + Zustand single-page app that connects to `VIDGEN_EVENTS` over `nats.ws`, folds events into project state, renders a live project board with an approval-gate UI, and dispatches the 7 frozen commands over HTTP — with components kept structurally pure by an ESLint ban on local state/side effects, proven by a fixture that must fail lint.

**Architecture:** One Zustand store (`src/store/store.ts`) owns every side effect: HTTP command dispatch and the `nats.ws` event-stream subscription. `src/store/events.ts` holds the frozen `VidgenEvent`/`foldProject`/`ProjectState` types, copied verbatim from `spikes/event-model/events.ts` (see "Design notes" below for why copy, not a shared package). `src/store/natsClient.ts` isolates the `wsconnect`/`jetstream` wiring behind a small `EventBusClient` interface so the store is dependency-injectable and testable without a live NATS server. Components under `src/components/**` are pure: they read store selectors and call store thunks, nothing else — enforced by a flat ESLint config that bans `useState`/`useReducer`/`useEffect` and direct `zustand`/`@nats-io/*` imports in that directory, with a fixture file (`src/components/__fixtures__/BadLocalState.tsx`) and a dedicated `bun run lint:prove-ban` script that prove the ban actually fires without adding a permanently-failing file to the normal `bun run lint` run.

**Tech Stack:** bun (package manager + JS/TS runtime), Vite 7, React 19, TypeScript 5 (strict), Zustand 5, `@nats-io/nats-core` (`wsconnect`) + `@nats-io/jetstream` (browser WS transport — Context7/D3-verified), `bun:test` (native runner) + `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` + `@happy-dom/global-registrator` (DOM registration via `bunfig.toml` preload), ESLint 9 flat config + `typescript-eslint`.

---

## Context7 verification (done during planning — bake these into the steps below, do not re-derive)

- **Zustand v5** (`/pmndrs/zustand`): typed stores use `create<T>()((set, get) => ({...}))` — the extra `()` before the state-creator arg is required for correct generic inference. Confirmed pattern used throughout Task 6–8.
- **Vite** (`/vitejs/vite`): `server.proxy` takes `{ '/path': { target, changeOrigin, ws } }`; the react-ts template's `vite.config.ts` is `defineConfig({ plugins: [react()] })`. Task 2 keeps `vite.config.ts` as a plain Vite config (`import { defineConfig } from 'vite'`) — test config lives entirely in `bunfig.toml` (see below), not merged into Vite's config the way Vitest would.
- **`bun:test`** (`/oven-sh/bun`): native runner, no separate config file for the runner itself — `bunfig.toml`'s `[test]` table's `preload` array runs setup scripts before every test file (Context7-confirmed: `docs/runtime/bunfig.mdx`, `docs/guides/test/testing-library.mdx`). Mocking API is a Jest-compatible subset: `import { mock, spyOn } from 'bun:test'` — `mock(impl)` replaces `vi.fn(impl)` (same `.mock.calls`/`.mock.results` shape and `toHaveBeenCalledTimes`/`toHaveBeenCalledWith` matchers), `spyOn(obj, 'method')` replaces `vi.spyOn`, `mock.module(path, factory)` replaces `vi.mock`. `test.each`/`describe.each` (and their `it.each` alias) are supported natively, same call shape as Vitest's.
- **DOM for `bun:test`** (`/oven-sh/bun`, `docs/test/dom.mdx` + `docs/guides/test/testing-library.mdx`): bun:test does not auto-provide a DOM the way Vitest's `environment: 'jsdom'` does. Component tests register one via a preload script: `import { GlobalRegistrator } from '@happy-dom/global-registrator'; GlobalRegistrator.register()`, wired through `bunfig.toml`'s `[test] preload = [...]` (Task 2, Step 5).
- **`@testing-library/react`**: `render`, `screen.getBy*`/`queryBy*`, `fireEvent`; `@testing-library/user-event`'s `userEvent.click(...)` is preferred for interaction tests (fires the full pointer event sequence, not just a synthetic click).
- **`@testing-library/jest-dom`**: with `bun:test`, import the bare `@testing-library/jest-dom` (not a framework-specific subpath) in the preload file — its default entry calls `expect.extend(...)` against the global `expect`, and bun:test's `expect` is Jest-API-compatible, so no special entry point is needed the way Vitest's `/vitest` subpath is.
- **ESLint flat config** (`/eslint/eslint`): `tseslint.config(...)` takes a flat array of config objects/spreads (`js.configs.recommended`, `...tseslint.configs.recommended`, then scoped objects with `files`/`rules`) — confirmed against `typescript-eslint`'s own integration-test fixtures, not assumed. `no-restricted-syntax` takes ESQuery AST selectors, e.g. `"CallExpression[callee.name='useState']"`, each with its own `message`. `no-restricted-imports`'s `patterns` array supports `{ group: [...], message }` gitignore-style globs. `no-undef` is turned off for `.ts`/`.tsx` per `typescript-eslint`'s own troubleshooting FAQ (TS's own compiler already catches undefined identifiers with full type info; `no-undef` false-positives on browser/DOM globals otherwise).
- **`@nats-io/nats-core` / `@nats-io/jetstream`** (`/nats-io/nats.js`, cross-checked against `spikes/nats-ws/main.ts` and `.okra/runs/disc-01/checkpoints/D3.md`): browser code imports `wsconnect` from `@nats-io/nats-core` (not `@nats-io/transport-node`), `jetstream` from `@nats-io/jetstream`. `js.consumers.get('VIDGEN_EVENTS')` with no second argument returns an **ordered ephemeral** consumer (auto-recreates on gaps, no server-side durable state, `m.ack()` is a harmless no-op). `c.consume({ callback: (m) => {...} })` is the verified delivery API. `JsMsg.json<T>()` parses the payload as JSON with a generic type parameter (confirmed against `/nats-io/nats.js` docs) — used to decode each message straight into a typed `VidgenEvent`, no `any`/`unknown`.

## Design notes (read before Task 1 — these are P4's own decisions, not restatements of frozen facts)

1. **`events.ts` is copied, not shared via an npm package.** Sharing one file between the Node `api` service and the Vite `frontend` app would need a monorepo workspace (npm/pnpm workspaces or a published internal package) that neither P1 nor P4 currently sets up, and P1 has not been authored yet. The index's own SCOPE text for this plan says "pick one, state it" — this plan copies `spikes/event-model/events.ts` verbatim into `frontend/src/store/events.ts` (Task 4), byte-for-byte, with a header comment pointing at the source of truth. **Consequence:** any future change to the `VidgenEvent` union must be applied in both `api/src/events.ts` (P1) and `frontend/src/store/events.ts` (this file) — flag this for whoever authors P5's C3 change-unit.
2. **`store.ts` + `natsClient.ts` split, both under `src/store/`.** Index §9 says "ALL nats.ws + fetch logic lives in store.ts, never in components" — read in context, that sentence is drawing the boundary between *components* (pure) and *the store layer* (impure), not mandating a single physical file. Splitting the `wsconnect`/`jetstream` wiring into `natsClient.ts` behind a 4-line `EventBusClient` interface is what makes `connect()`/`disconnect()` unit-testable at all without a live NATS server (Task 8) — hand-rolling fakes for the real `NatsConnection`/`JetStreamClient` types would mean asserting large, partially-unverified surface area. Nothing outside `src/store/` imports `natsClient.ts` directly; components only ever see `store.ts`'s `useVidgenStore` hook. The frozen store *surface* (state fields, `applyEvent`, the 7 command thunks, `connect`/`disconnect`) is reproduced exactly as index §9 specifies.
3. **The ESLint import ban is a deliberately-scoped deny-list, not the literal "components may only import store/** + ui/**" allow-list.** ESLint's `no-restricted-imports` has no native "allow only these paths" mode — `patterns`/`group` express *forbidden* globs (with `!`-negation to carve out exceptions from a forbidden group), not a closed allow-list over arbitrary relative paths. This plan instead denies the two concrete ways a component could smuggle in the logic the ban is meant to keep out: importing `@nats-io/*` directly, and importing `zustand` directly (bypassing the typed `useVidgenStore` hook). That is the enforceable subset of the intent stated in the SCOPE text; a literal allow-list would need a custom rule (out of scope here — flag as a follow-up if it matters later).
4. **Assumption flagged, not invented as fact — api's dev HTTP port.** Index §8 pins NATS's ports (TCP 4223, WS 8081, monitor 8223) but says nothing about `api`'s own HTTP port, because P1 (which owns `api/src/http.ts`) has not been written yet (confirmed: `2026-07-09-vidgen-webapp-02-agent-sdk-script.md` explicitly says P1 hasn't landed `commands.ts`/`http.ts` yet). Task 2's `vite.config.ts` dev proxy target defaults to `http://localhost:9999` — a value chosen to be *obviously* a placeholder (not a disguised guess) — overridable via `VITE_API_PROXY_TARGET`, and the code comment says explicitly to reconcile it against `api`'s real dev port when P1 is authored. This does not block P4: proxying only matters for `bun run dev` against a live `api`; the build, tests, and lint in this plan never depend on the value being correct.
5. **Prod serving handoff to `api`.** Per index §3 (`api/src/http.ts`: "serve SPA") and §5, `api` — not a separate frontend container — serves the built SPA in production. Task 15's Dockerfile therefore has a `build` stage that produces `frontend/dist/`, which `api`'s own Dockerfile (P1) is expected to `COPY --from=` into whatever directory `http.ts` serves statically (assumed `public/` — confirm against `api/src/http.ts` when P1 is authored). The `dev` stage runs the Vite dev server for local docker-compose use (the `frontend` service in index §2's runtime diagram).

---

## File Structure

```
frontend/
  package.json  bun.lock  tsconfig.json  vite.config.ts  index.html
  bunfig.toml  test-setup.ts
  eslint.config.js
  scripts/prove-lint-ban.sh
  Dockerfile
  src/
    main.tsx
    App.tsx
    vite-env.d.ts
    store/
      events.ts        events.test.ts
      natsClient.ts
      store.ts          store.test.ts
    ui/
      Button.tsx        Button.test.tsx
      Badge.tsx          Badge.test.tsx
    components/
      __fixtures__/BadLocalState.tsx   (excluded from normal lint — see Task 3)
      ConnectionStatus.tsx   ConnectionStatus.test.tsx
      CostBadge.tsx          CostBadge.test.tsx
      SceneStrip.tsx         SceneStrip.test.tsx
      ProjectCard.tsx        ProjectCard.test.tsx
      Board.tsx              Board.test.tsx
      StoryboardApproval.tsx StoryboardApproval.test.tsx
```

---

## Task 1: Scaffold the Vite + React + TS project

**Files:**
- Create: `frontend/` (via `bun create vite`)

- [ ] **Step 1: Scaffold with create-vite**

Run from the repo root:

```bash
bun create vite frontend --template react-ts
```

Expected: a `frontend/` directory is created containing `package.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `eslint.config.js`, and demo assets. Output ends with instructions to `cd frontend`, install, and run.

- [ ] **Step 2: Install default dependencies**

```bash
cd frontend && bun install
```

Expected: `node_modules/` created, `bun.lock` written, no errors.

- [ ] **Step 3: Verify the untouched scaffold builds**

```bash
bun run build
```

Expected: `vite v7.x.x building for production...` then `✓ built in <N>ms` and a `dist/` directory. This is the last time the demo counter app builds — Task 14 replaces it.

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "chore(frontend): scaffold Vite + React + TS project"
```

---

## Task 2: Dependencies, single `tsconfig.json`, `vite.config.ts` (build + Vitest + dev proxy)

**Files:**
- Modify: `frontend/package.json` (dependencies, devDependencies, `scripts`)
- Modify: `frontend/tsconfig.json` (replaces the split app/node config with one file)
- Delete: `frontend/tsconfig.app.json`, `frontend/tsconfig.node.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/test-setup.ts`, `frontend/bunfig.toml`
- Modify: `frontend/src/vite-env.d.ts`

- [ ] **Step 1: Install runtime and test dependencies**

```bash
cd frontend
bun add zustand@latest @nats-io/nats-core@latest @nats-io/jetstream@latest
bun add -d @testing-library/react@latest @testing-library/jest-dom@latest @testing-library/user-event@latest @happy-dom/global-registrator@latest bun-types@latest
```

Expected: `package.json`'s `dependencies` gains `zustand`, `@nats-io/nats-core`, `@nats-io/jetstream`; `devDependencies` gains `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@happy-dom/global-registrator`, `bun-types`. No errors. (No `vitest`/`jsdom` — `bun:test` is the runner and `@happy-dom/global-registrator` supplies the DOM, see Step 5.)

- [ ] **Step 2: Rewrite `package.json`'s `scripts` block**

Open `frontend/package.json` and replace the `"scripts"` object with:

```json
"scripts": {
  "dev": "bunx vite",
  "build": "bunx vite build",
  "preview": "bunx vite preview",
  "test": "bun test",
  "lint": "bunx eslint .",
  "lint:prove-ban": "bash scripts/prove-lint-ban.sh"
}
```

(`lint:prove-ban` runs a script created in Task 3 — the script doesn't exist yet, which is fine, this step only edits `package.json`.)

- [ ] **Step 3: Consolidate to one `tsconfig.json`**

```bash
rm frontend/tsconfig.app.json frontend/tsconfig.node.json
```

Replace `frontend/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "bun-types", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "test-setup.ts"]
}
```

- [ ] **Step 4: Rewrite `vite.config.ts` (build config + dev proxy, one file — test config lives in `bunfig.toml`, Step 5)**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ASSUMPTION (flagged, not a frozen fact): P1 (api-core) has not been written
// yet, so api's dev HTTP port is undetermined by
// docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md (§8 only pins
// NATS's ports). 9999 is a deliberately-obvious placeholder, not a guess at
// the real value — override with VITE_API_PROXY_TARGET, and reconcile this
// default against api's actual dev port once P1 is authored. Nothing in this
// plan's build/test/lint steps depends on this value being correct; it only
// matters for `bun run dev` against a live api.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:9999'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/media': { target: apiProxyTarget, changeOrigin: true },
    },
  },
})
```

- [ ] **Step 5: Add the `bun:test` DOM preload (happy-dom + jest-dom) and wire it via `bunfig.toml`**

`bun:test` does not auto-provide a DOM the way Vitest's `environment: 'jsdom'` does (Context7-confirmed: `docs/test/dom.mdx`). Component tests (Tasks 9–13) render into `document`, so register `happy-dom`'s globals once, before any test file runs, via a preload script.

Create `frontend/test-setup.ts`:

```typescript
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import '@testing-library/jest-dom'

GlobalRegistrator.register()
```

Create `frontend/bunfig.toml`:

```toml
[test]
preload = ["./test-setup.ts"]
```

(`events.test.ts` and `store.test.ts`, Tasks 4/6–8, never touch `document`/`window` — they run fine with the DOM registered but unused.)

- [ ] **Step 6: Extend the Vite env types**

Replace `frontend/src/vite-env.d.ts` with:

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NATS_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 7: Verify the config change still typechecks and builds**

```bash
bun run build
```

Expected: `✓ built in <N>ms`, no TypeScript errors. (Still builds the Task 1 demo `App.tsx` — that gets replaced in Task 14, not here.)

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock tsconfig.json vite.config.ts test-setup.ts bunfig.toml src/vite-env.d.ts
git rm tsconfig.app.json tsconfig.node.json
git commit -m "chore(frontend): add zustand/nats/bun:test deps, single tsconfig, dev proxy + test config"
```

---

## Task 3: ESLint flat config — local-state ban, import ban, and the fixture proof

**Files:**
- Modify: `frontend/eslint.config.js`
- Create: `frontend/src/components/__fixtures__/BadLocalState.tsx`
- Create: `frontend/scripts/prove-lint-ban.sh`

- [ ] **Step 1: Remove the template's unused react-hooks/react-refresh eslint plugins**

The scaffold's default `eslint.config.js` (about to be replaced) references `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`. This plan's config (Step 2) doesn't use them — dropping them keeps `package.json` free of unverified/unused plugin API surface (see Context7 verification note above: only `@eslint/js` + `typescript-eslint` APIs were confirmed).

```bash
cd frontend
bun remove eslint-plugin-react-hooks eslint-plugin-react-refresh
```

Expected: both removed from `devDependencies`.

- [ ] **Step 2: Replace `eslint.config.js`**

```javascript
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'src/components/__fixtures__/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      // TypeScript's own compiler (`tsc --noEmit`, part of the editor/CI
      // typecheck) already catches undefined identifiers with full type
      // information;
      // `no-undef` false-positives on browser/DOM globals and TS ambient
      // types otherwise. Context7-confirmed pattern from typescript-eslint's
      // own ESLint troubleshooting FAQ.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Local-state + side-effect ban: src/components/** must be pure. All
    // state and all side effects (fetch, nats.ws) live in src/store/*;
    // components read store selectors and dispatch store actions only.
    // useRef is intentionally NOT banned — it's allowed for DOM refs.
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='useState']",
          message:
            'src/components/** may not hold local state (useState banned). Read from useVidgenStore (src/store/store.ts) via a selector instead.',
        },
        {
          selector: "CallExpression[callee.name='useReducer']",
          message:
            'src/components/** may not hold local state (useReducer banned). Read from useVidgenStore (src/store/store.ts) via a selector instead.',
        },
        {
          selector: "CallExpression[callee.name='useEffect']",
          message:
            'src/components/** may not run side effects (useEffect banned). Side effects (fetch, nats.ws) belong in src/store/store.ts, wired once at bootstrap in src/main.tsx.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nats-io/*'],
              message:
                'nats.ws wiring belongs only in src/store/natsClient.ts. Dispatch store actions instead of importing NATS directly.',
            },
            {
              group: ['zustand', 'zustand/*'],
              message:
                "Import the typed hook from '../store/store' (useVidgenStore), not zustand directly — this keeps store construction in one place.",
            },
          ],
        },
      ],
    },
  },
)
```

- [ ] **Step 3: Add the fixture that must fail lint**

Create `frontend/src/components/__fixtures__/BadLocalState.tsx`:

```tsx
import { useState } from 'react'

// FIXTURE — intentionally violates the src/components/** local-state ban.
// This file is globally ignored by `bun run lint` (see the `ignores` entry
// in eslint.config.js) so it never breaks the normal suite. It exists solely
// to be targeted directly by `bun run lint:prove-ban` (scripts/prove-lint-ban.sh),
// which asserts ESLint still rejects it — i.e. that the ban actually bites.
export function BadLocalState() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

- [ ] **Step 4: Confirm the normal lint run is clean (fixture excluded)**

```bash
bun run lint
```

Expected: exits 0, no output (or only pre-existing warnings from other files, none yet since `src/` is still the untouched Task 1 demo app plus this one ignored fixture).

- [ ] **Step 5: Confirm the ban does NOT bite when the fixture is ignored (sanity check before adding the proof)**

```bash
bunx eslint src/components/__fixtures__/BadLocalState.tsx
```

Expected: exits 0 with a message like `File ignored because of a matching ignore pattern` — proving the file really is excluded from the default run, not just untouched by accident.

- [ ] **Step 6: Write the proof script**

Create `frontend/scripts/prove-lint-ban.sh`:

```bash
#!/usr/bin/env bash
# Proves the local-state ESLint ban actually fires, without adding the
# violating fixture to the normal `bun run lint` run (eslint.config.js
# globally ignores src/components/__fixtures__/**, see Step 4/5 above).
#
# `--no-ignore` forces ESLint to lint the fixture despite the ignore entry.
# If ESLint accepts it (exit 0), that's a REGRESSION in the ban — this
# script fails CI. If ESLint rejects it (non-zero, the expected case), this
# script prints a confirmation and exits 0.
set -euo pipefail
cd "$(dirname "$0")/.."

if bunx eslint --no-ignore src/components/__fixtures__/BadLocalState.tsx; then
  echo "REGRESSION: eslint did not reject src/components/__fixtures__/BadLocalState.tsx" >&2
  echo "The local-state ban (no-restricted-syntax on useState) is no longer enforced." >&2
  exit 1
fi

echo "OK: local-state ban correctly rejected the useState fixture"
```

- [ ] **Step 7: Run the proof script and confirm it reports OK**

```bash
bun run lint:prove-ban
```

Expected output ends with:

```
OK: local-state ban correctly rejected the useState fixture
```

(The `bunx eslint ...` line inside the script prints ESLint's own error report — e.g. `error  src/components/__fixtures__/BadLocalState.tsx: ... useState banned ...` — before the `if` catches its non-zero exit; that's expected, not a failure of this step.)

- [ ] **Step 8: Confirm `bun run lint` is still clean with the proof script present**

```bash
bun run lint
```

Expected: exits 0 — `scripts/prove-lint-ban.sh` is a shell script, not matched by ESLint's `**/*.{ts,tsx,mts,cts}` file targeting, so it doesn't need its own ignore entry.

- [ ] **Step 9: Commit**

```bash
git add eslint.config.js src/components/__fixtures__/BadLocalState.tsx scripts/prove-lint-ban.sh package.json bun.lock
git commit -m "feat(frontend): eslint local-state/side-effect ban + fixture proof"
```

---

## Task 4: `store/events.ts` — promoted event types + pure fold tests

**Files:**
- Create: `frontend/src/store/events.ts`
- Test: `frontend/src/store/events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/store/events.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { foldProject, type VidgenEvent } from './events'

const at = '2026-01-01T00:00:00Z'

describe('foldProject', () => {
  it('starts a project in draft on ProjectCreated', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun' },
    ]
    const state = foldProject(events)
    expect(state).toMatchObject({ projectId: 'p1', status: 'draft', spentUsd: 0, approved: false })
  })

  it('adds scenes and scriptUsd on ScriptGenerated, moves to scripted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at, scenes: [{ idx: 0, narration: 'n', visual: 'v' }], scriptUsd: 0 },
    ]
    const state = foldProject(events)
    expect(state.status).toBe('scripted')
    expect(state.scenes).toEqual([{ idx: 0, narration: 'n', visual: 'v' }])
    expect(state.spentUsd).toBe(0)
  })

  it('moves to material on MaterialResolved', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at, sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' },
    ]
    expect(foldProject(events).status).toBe('material')
  })

  it('accumulates ttsUsd across VoiceSynthesized events', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 2, tone: 'fun' },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at, sceneIdx: 0, mp3Path: 'a.mp3', ttsUsd: 0.02 },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at, sceneIdx: 1, mp3Path: 'b.mp3', ttsUsd: 0.03 },
    ]
    expect(foldProject(events).spentUsd).toBeCloseTo(0.05)
  })

  it('moves to awaiting_approval on AwaitingApproval', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at },
    ]
    expect(foldProject(events).status).toBe('awaiting_approval')
  })

  it('sets approved=true and status approved on ApprovalGranted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at },
    ]
    const state = foldProject(events)
    expect(state.approved).toBe(true)
    expect(state.status).toBe('approved')
  })

  it('records outputPath and renderUsd on RenderCompleted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at, outputPath: '/out/p1.mp4', renderUsd: 0 },
    ]
    const state = foldProject(events)
    expect(state.status).toBe('rendered')
    expect(state.outputPath).toBe('/out/p1.mp4')
  })

  it('moves to published on Published, and failed on RunFailed', () => {
    const published = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'Published', projectId: 'p1', at, platform: 'tiktok', postId: 'x', url: 'https://x' },
    ])
    expect(published.status).toBe('published')

    const failed = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun' },
      { v: 1, type: 'RunFailed', projectId: 'p1', at, stage: 'tts', error: 'boom' },
    ])
    expect(failed.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test events.test
```

Expected: FAIL — `Cannot find module './events'` (or similar), since `events.ts` doesn't exist yet.

- [ ] **Step 3: Create `events.ts` — verbatim copy of the frozen contract**

Create `frontend/src/store/events.ts` with this exact content (byte-identical body to `spikes/event-model/events.ts`, per index §4's "promoted... unchanged" instruction — this repo's copy for the frontend package, see Design note 1 above):

```typescript
// Frozen event contract — copied verbatim from spikes/event-model/events.ts
// (index §4: "the exact TS union lives in spikes/event-model/events.ts").
// Do NOT alter field shapes here. If the event union changes, update BOTH
// this file and api/src/events.ts (P1) — see Design note 1 in this plan.

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

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test events.test
```

Expected: `1 pass` across the file (bun:test's summary line format), 8 passing assertions/tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/events.ts src/store/events.test.ts
git commit -m "feat(frontend): promote frozen VidgenEvent/foldProject/ProjectState"
```

---

## Task 5: `store/natsClient.ts` — browser event-bus wiring

**Files:**
- Create: `frontend/src/store/natsClient.ts`

No unit test: this file is a thin wrapper with no branching logic around the Context7-and-checkpoint-D3-verified `wsconnect`/`jetstream`/`consumers.get`/`consume` pattern (`spikes/nats-ws/main.ts`, `.okra/runs/disc-01/checkpoints/D3.md`) — there is nothing pure to assert without a live NATS server. It's exercised indirectly: `store.test.ts` (Task 8) substitutes a fake `EventBusClient` to test `connect()`/`disconnect()`'s wiring logic, and this real implementation is exercised end-to-end in Task 16's manual verification against the running `docker-compose` NATS container.

- [ ] **Step 1: Write `natsClient.ts`**

Create `frontend/src/store/natsClient.ts`:

```typescript
import { wsconnect } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'
import type { VidgenEvent } from './events'

/** The narrow surface store.ts needs from nats.ws — small enough to fake in tests. */
export interface EventBusClient {
  /**
   * Subscribes to VIDGEN_EVENTS and invokes onEvent for each message,
   * decoded straight into a typed VidgenEvent (no runtime schema
   * validation — out of scope for P4, events are trusted per the frozen
   * contract in index §4). Resolves once the subscription is live and
   * returns a teardown function.
   */
  consume(onEvent: (subject: string, event: VidgenEvent) => void): Promise<() => Promise<void>>
}

export interface EventBusClientOptions {
  wsUrl: string
}

/**
 * Real nats.ws implementation. Verified pattern (Context7 + D3 checkpoint):
 * wsconnect (from @nats-io/nats-core, NOT @nats-io/transport-node) +
 * jetstream + js.consumers.get('VIDGEN_EVENTS') with no name arg (ordered
 * ephemeral consumer) + c.consume({ callback }).
 */
export function createNatsEventBusClient(opts: EventBusClientOptions): EventBusClient {
  return {
    async consume(onEvent) {
      const nc = await wsconnect({ servers: opts.wsUrl })
      const js = jetstream(nc)
      const consumer = await js.consumers.get('VIDGEN_EVENTS')
      await consumer.consume({
        callback: (m) => {
          onEvent(m.subject, m.json<VidgenEvent>())
          m.ack()
        },
      })
      return async () => {
        await nc.close()
      }
    },
  }
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
bun run build
```

Expected: `✓ built in <N>ms`, no TypeScript errors (still builds the Task 1 demo `App.tsx` — `natsClient.ts` isn't imported by anything yet, so this only proves it typechecks in isolation as part of the project).

- [ ] **Step 3: Commit**

```bash
git add src/store/natsClient.ts
git commit -m "feat(frontend): nats.ws EventBusClient (browser WS, ordered consumer)"
```

---

## Task 6: `store/store.ts` — state shape + incremental `applyEvent`

**Files:**
- Create: `frontend/src/store/store.ts`
- Test: `frontend/src/store/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/store/store.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { createVidgenStore, type VidgenStoreDeps } from './store'
import type { EventBusClient } from './natsClient'

function fakeDeps(overrides: Partial<VidgenStoreDeps> = {}): VidgenStoreDeps {
  return {
    fetchImpl: mock(async () => new Response(null, { status: 200 })),
    eventBusClient: {
      consume: mock(async () => async () => {}),
    },
    ...overrides,
  }
}

describe('applyEvent', () => {
  it('folds events for a project incrementally', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().applyEvent('vidgen.evt.p1.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-01-01T00:00:00Z',
      idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun',
    })
    store.getState().applyEvent('vidgen.evt.p1.ScriptGenerated', {
      v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-01-01T00:00:01Z',
      scenes: [{ idx: 0, narration: 'n', visual: 'v' }], scriptUsd: 0,
    })
    const project = store.getState().projects.p1
    expect(project.status).toBe('scripted')
    expect(project.scenes).toHaveLength(1)
    expect(project.spentUsd).toBe(0)
  })

  it('keeps two projects independent', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().applyEvent('vidgen.evt.p1.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-01-01T00:00:00Z',
      idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun',
    })
    store.getState().applyEvent('vidgen.evt.p2.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p2', at: '2026-01-01T00:00:00Z',
      idea: 'dogs', durationSec: 30, sceneCount: 1, tone: 'fun',
    })
    expect(Object.keys(store.getState().projects).sort()).toEqual(['p1', 'p2'])
  })
})

describe('select', () => {
  it('sets selectedId', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().select('p1')
    expect(store.getState().selectedId).toBe('p1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test store.test
```

Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write `store.ts` (state + applyEvent + select only — thunks and connect/disconnect come in Tasks 7–8)**

Create `frontend/src/store/store.ts`:

```typescript
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { foldProject, type ProjectState, type VidgenEvent } from './events'
import type { EventBusClient } from './natsClient'

export type ConnectionState = 'connecting' | 'live' | 'down'

export interface VidgenStore {
  projects: Record<string, ProjectState>
  eventLog: Record<string, VidgenEvent[]>
  connection: ConnectionState
  selectedId?: string
  applyEvent: (subject: string, event: VidgenEvent) => void
  select: (projectId: string) => void
}

export interface VidgenStoreDeps {
  fetchImpl: typeof fetch
  eventBusClient: EventBusClient
}

export function createVidgenStore(deps: VidgenStoreDeps): UseBoundStore<StoreApi<VidgenStore>> {
  // deps.fetchImpl/deps.eventBusClient are unused in this task's slice of the
  // store (thunks land in Task 7, connect/disconnect in Task 8) but are
  // threaded through now so the exported factory signature doesn't change
  // shape across tasks.
  void deps

  return create<VidgenStore>()((set) => ({
    projects: {},
    eventLog: {},
    connection: 'down',
    selectedId: undefined,

    applyEvent: (subject, event) => {
      if (!subject.startsWith(`vidgen.evt.${event.projectId}.`)) {
        console.warn(`applyEvent: subject "${subject}" does not match project "${event.projectId}"`)
      }
      set((state) => {
        const log = [...(state.eventLog[event.projectId] ?? []), event]
        return {
          eventLog: { ...state.eventLog, [event.projectId]: log },
          projects: { ...state.projects, [event.projectId]: foldProject(log) },
        }
      })
    },

    select: (projectId) => set({ selectedId: projectId }),
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test store.test
```

Expected: `3 pass` in `store.test.ts` (bun:test's summary line format).

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(frontend): zustand store — state shape + incremental applyEvent"
```

---

## Task 7: `store/store.ts` — the 7 command thunks

**Files:**
- Modify: `frontend/src/store/store.ts`
- Modify: `frontend/src/store/store.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `frontend/src/store/store.test.ts` (add this `describe` block; keep the two existing ones):

```typescript
describe('command thunks', () => {
  it('createProject posts to /api/commands/CreateProject with the body fields plus an idempotencyKey', async () => {
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl }))
    await store.getState().createProject({ idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/commands/CreateProject')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.idea).toBe('cats')
    expect(body.durationSec).toBe(30)
    expect(typeof body.idempotencyKey).toBe('string')
  })

  it.each([
    ['generateScript', 'GenerateScript', { projectId: 'p1' }],
    ['resolveMaterial', 'ResolveMaterial', { projectId: 'p1' }],
    ['generateVoiceovers', 'GenerateVoiceovers', { projectId: 'p1' }],
    ['requestApproval', 'RequestApproval', { projectId: 'p1' }],
    ['approveStoryboard', 'ApproveStoryboard', { projectId: 'p1' }],
    ['publish', 'Publish', { projectId: 'p1', caption: 'hi', privacy: 'public' }],
  ] as const)('%s posts to /api/commands/%s', async (action, path, input) => {
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl }))
    // eslint rules don't apply to store.ts's own tests — action is a key of VidgenStore's thunks.
    await (store.getState()[action] as (i: typeof input) => Promise<void>)(input)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/commands/${path}`)
  })

  it('rejects when the server responds non-2xx', async () => {
    const fetchImpl = mock(async () => new Response('conflict', { status: 409 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl }))
    await expect(store.getState().approveStoryboard({ projectId: 'p1' })).rejects.toThrow(/409/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test store.test
```

Expected: FAIL — `store.getState().createProject is not a function` (and the parametrized cases fail the same way).

- [ ] **Step 3: Add the thunks to `store.ts`**

Replace the full contents of `frontend/src/store/store.ts` with:

```typescript
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { foldProject, type ProjectState, type VidgenEvent } from './events'
import type { EventBusClient } from './natsClient'

export type ConnectionState = 'connecting' | 'live' | 'down'

export interface CreateProjectInput {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
}

export interface ProjectIdInput {
  projectId: string
}

export interface PublishInput {
  projectId: string
  caption: string
  privacy: string
}

export interface VidgenStore {
  projects: Record<string, ProjectState>
  eventLog: Record<string, VidgenEvent[]>
  connection: ConnectionState
  selectedId?: string
  applyEvent: (subject: string, event: VidgenEvent) => void
  select: (projectId: string) => void
  createProject: (input: CreateProjectInput) => Promise<void>
  generateScript: (input: ProjectIdInput) => Promise<void>
  resolveMaterial: (input: ProjectIdInput) => Promise<void>
  generateVoiceovers: (input: ProjectIdInput) => Promise<void>
  requestApproval: (input: ProjectIdInput) => Promise<void>
  approveStoryboard: (input: ProjectIdInput) => Promise<void>
  publish: (input: PublishInput) => Promise<void>
}

export interface VidgenStoreDeps {
  fetchImpl: typeof fetch
  eventBusClient: EventBusClient
}

// P4's assumption on wire format (index §5 specifies command names and body
// fields, not the idempotencyKey transport): idempotencyKey rides as an
// extra top-level JSON body field alongside the command's own fields.
// Reconcile against P1's actual command handlers when P1 is authored.
async function postCommand<TBody extends object>(
  fetchImpl: typeof fetch,
  name: string,
  body: TBody,
): Promise<void> {
  const payload = { ...body, idempotencyKey: crypto.randomUUID() }
  const res = await fetchImpl(`/api/commands/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`command ${name} failed: ${res.status} ${res.statusText}`)
  }
}

export function createVidgenStore(deps: VidgenStoreDeps): UseBoundStore<StoreApi<VidgenStore>> {
  return create<VidgenStore>()((set) => ({
    projects: {},
    eventLog: {},
    connection: 'down',
    selectedId: undefined,

    applyEvent: (subject, event) => {
      if (!subject.startsWith(`vidgen.evt.${event.projectId}.`)) {
        console.warn(`applyEvent: subject "${subject}" does not match project "${event.projectId}"`)
      }
      set((state) => {
        const log = [...(state.eventLog[event.projectId] ?? []), event]
        return {
          eventLog: { ...state.eventLog, [event.projectId]: log },
          projects: { ...state.projects, [event.projectId]: foldProject(log) },
        }
      })
    },

    select: (projectId) => set({ selectedId: projectId }),

    createProject: (input) => postCommand(deps.fetchImpl, 'CreateProject', input),
    generateScript: (input) => postCommand(deps.fetchImpl, 'GenerateScript', input),
    resolveMaterial: (input) => postCommand(deps.fetchImpl, 'ResolveMaterial', input),
    generateVoiceovers: (input) => postCommand(deps.fetchImpl, 'GenerateVoiceovers', input),
    requestApproval: (input) => postCommand(deps.fetchImpl, 'RequestApproval', input),
    approveStoryboard: (input) => postCommand(deps.fetchImpl, 'ApproveStoryboard', input),
    publish: (input) => postCommand(deps.fetchImpl, 'Publish', input),
  }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test store.test
```

Expected: `11 pass` in `store.test.ts` (3 from Task 6 + 8 from this task: 1 createProject + 6 parametrized + 1 rejection).

- [ ] **Step 5: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(frontend): store command thunks — the 7 frozen commands (index §5)"
```

---

## Task 8: `store/store.ts` — `connect()`/`disconnect()` + the exported singleton

**Files:**
- Modify: `frontend/src/store/store.ts`
- Modify: `frontend/src/store/store.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `frontend/src/store/store.test.ts`:

```typescript
import type { VidgenEvent as VidgenEventType } from './events'

describe('connect/disconnect', () => {
  it('goes live and applies events delivered by the event bus', async () => {
    const event: VidgenEventType = {
      v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-01-01T00:00:00Z',
    }
    const unsubscribe = mock(async () => {})
    const eventBusClient: EventBusClient = {
      consume: mock(async (onEvent) => {
        onEvent('vidgen.evt.p1.AwaitingApproval', event)
        return unsubscribe
      }),
    }
    const store = createVidgenStore(fakeDeps({ eventBusClient }))

    await store.getState().connect()

    expect(store.getState().connection).toBe('live')
    expect(store.getState().projects.p1.status).toBe('awaiting_approval')

    await store.getState().disconnect()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.getState().connection).toBe('down')
  })

  it('marks the connection down and rethrows when the event bus fails to connect', async () => {
    const eventBusClient: EventBusClient = {
      consume: mock(async () => {
        throw new Error('ws refused')
      }),
    }
    const store = createVidgenStore(fakeDeps({ eventBusClient }))
    await expect(store.getState().connect()).rejects.toThrow('ws refused')
    expect(store.getState().connection).toBe('down')
  })
})
```

Also move the `import type { VidgenEvent as VidgenEventType } from './events'` line to the top of the file alongside the existing imports (it's shown inline above only to mark where it's newly needed).

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test store.test
```

Expected: FAIL — `store.getState().connect is not a function`.

- [ ] **Step 3: Add `connect`/`disconnect` to the `VidgenStore` interface and implementation, and export the singleton**

In `frontend/src/store/store.ts`:

Add to the `VidgenStore` interface (after `publish`):

```typescript
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /** @internal set by connect(); torn down by disconnect(). Not read by components. */
  _unsubscribe?: () => Promise<void>
```

Add to the object returned inside `create<VidgenStore>()((set, get) => ({ ... }))` — note this also changes the state creator's signature from `(set) =>` to `(set, get) =>`:

```typescript
    connect: async () => {
      set({ connection: 'connecting' })
      try {
        const unsubscribe = await deps.eventBusClient.consume((subject, event) => {
          get().applyEvent(subject, event)
        })
        set({ connection: 'live', _unsubscribe: unsubscribe })
      } catch (err) {
        set({ connection: 'down' })
        throw err
      }
    },

    disconnect: async () => {
      const unsubscribe = get()._unsubscribe
      set({ connection: 'down', _unsubscribe: undefined })
      if (unsubscribe) {
        await unsubscribe()
      }
    },
```

At the bottom of the file, export the default (browser-real) singleton:

```typescript
import { createNatsEventBusClient } from './natsClient'

const defaultDeps: VidgenStoreDeps = {
  // A wrapper, not a direct `fetch` reference — this keeps the lookup
  // dynamic so tests can reassign `globalThis.fetch = mock(...)` directly
  // (bun:test has no `vi.stubGlobal`) and have it take effect even though
  // this module was already imported.
  fetchImpl: (input, init) => fetch(input, init),
  eventBusClient: createNatsEventBusClient({
    wsUrl: import.meta.env.VITE_NATS_WS_URL ?? 'ws://localhost:8081',
  }),
}

export const useVidgenStore = createVidgenStore(defaultDeps)
```

(Move this `import` to the top of the file with the others; it's shown here only to mark what's newly needed. `ws://localhost:8081` is index §8's frozen browser-facing NATS WS port — not a placeholder, unlike the api proxy target in Task 2.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test store.test
```

Expected: `13 pass` in `store.test.ts`.

- [ ] **Step 5: Run the full test suite and build to make sure nothing else broke**

```bash
bun test
bun run build
```

Expected: all test files pass; `✓ built in <N>ms` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/store.ts src/store/store.test.ts
git commit -m "feat(frontend): store connect()/disconnect() + exported useVidgenStore singleton"
```

---

## Task 9: `ui/` primitives — `Button`, `Badge`

**Files:**
- Create: `frontend/src/ui/Button.tsx`, `frontend/src/ui/Button.test.tsx`
- Create: `frontend/src/ui/Badge.tsx`, `frontend/src/ui/Badge.test.tsx`

`src/ui/**` is presentational-only and is **not** covered by the `src/components/**` local-state ban (see Design note 3) — these stay simple and stateless here because they don't need state, not because the lint rule forbids it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/ui/Button.test.tsx`:

```tsx
import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders children and forwards onClick', async () => {
    const onClick = mock()
    render(<Button onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

Create `frontend/src/ui/Badge.test.tsx`:

```tsx
import { describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="good">Live</Badge>)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test ui/
```

Expected: FAIL — `Cannot find module './Button'` / `./Badge'`.

- [ ] **Step 3: Write the components**

Create `frontend/src/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export function Button({ children, ...rest }: ButtonProps) {
  return (
    <button className="vg-button" {...rest}>
      {children}
    </button>
  )
}
```

Create `frontend/src/ui/Badge.tsx`:

```tsx
import type { ReactNode } from 'react'

interface BadgeProps {
  tone?: 'neutral' | 'good' | 'bad'
  children: ReactNode
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={`vg-badge vg-badge--${tone}`}>{children}</span>
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test ui/
```

Expected: `2 pass` across `Button.test.tsx` + `Badge.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat(frontend): ui primitives — Button, Badge"
```

---

## Task 10: `components/ConnectionStatus` + `components/CostBadge`

**Files:**
- Create: `frontend/src/components/ConnectionStatus.tsx`, `.test.tsx`
- Create: `frontend/src/components/CostBadge.tsx`, `.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ConnectionStatus.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { ConnectionStatus } from './ConnectionStatus'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('ConnectionStatus', () => {
  it('renders Live when the store connection is live', () => {
    useVidgenStore.setState({ connection: 'live' })
    render(<ConnectionStatus />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('renders Disconnected when down', () => {
    render(<ConnectionStatus />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('renders Connecting… while connecting', () => {
    useVidgenStore.setState({ connection: 'connecting' })
    render(<ConnectionStatus />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })
})
```

Create `frontend/src/components/CostBadge.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('CostBadge', () => {
  it('renders the project spend formatted as dollars', () => {
    useVidgenStore.setState({
      projects: { p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0.045, approved: false } },
    })
    render(<CostBadge projectId="p1" />)
    expect(screen.getByText('$0.05')).toBeInTheDocument()
  })

  it('renders $0.00 for a project not yet in the store', () => {
    render(<CostBadge projectId="missing" />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test components/ConnectionStatus components/CostBadge
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write the components**

Create `frontend/src/components/ConnectionStatus.tsx`:

```tsx
import { Badge } from '../ui/Badge'
import { useVidgenStore, type ConnectionState } from '../store/store'

const LABEL: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  down: 'Disconnected',
}

const TONE: Record<ConnectionState, 'neutral' | 'good' | 'bad'> = {
  connecting: 'neutral',
  live: 'good',
  down: 'bad',
}

export function ConnectionStatus() {
  const connection = useVidgenStore((state) => state.connection)
  return <Badge tone={TONE[connection]}>{LABEL[connection]}</Badge>
}
```

Create `frontend/src/components/CostBadge.tsx`:

```tsx
import { Badge } from '../ui/Badge'
import { useVidgenStore } from '../store/store'

interface CostBadgeProps {
  projectId: string
}

export function CostBadge({ projectId }: CostBadgeProps) {
  const spentUsd = useVidgenStore((state) => state.projects[projectId]?.spentUsd ?? 0)
  return <Badge tone={spentUsd > 0.1 ? 'bad' : 'neutral'}>${spentUsd.toFixed(2)}</Badge>
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test components/ConnectionStatus components/CostBadge
```

Expected: `5 pass` across `ConnectionStatus.test.tsx` + `CostBadge.test.tsx`.

- [ ] **Step 5: Run lint to confirm these pure components pass the local-state ban**

```bash
bun run lint
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/ConnectionStatus.tsx src/components/ConnectionStatus.test.tsx src/components/CostBadge.tsx src/components/CostBadge.test.tsx
git commit -m "feat(frontend): ConnectionStatus + CostBadge components"
```

---

## Task 11: `components/SceneStrip` + `components/ProjectCard`

**Files:**
- Create: `frontend/src/components/SceneStrip.tsx`, `.test.tsx`
- Create: `frontend/src/components/ProjectCard.tsx`, `.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/SceneStrip.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { SceneStrip } from './SceneStrip'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('SceneStrip', () => {
  it('renders each scene narration', () => {
    useVidgenStore.setState({
      projects: {
        p1: {
          projectId: 'p1', status: 'scripted', spentUsd: 0, approved: false,
          scenes: [
            { idx: 0, narration: 'A cat wakes up', visual: 'sunrise' },
            { idx: 1, narration: 'The cat stretches', visual: 'yawn' },
          ],
        },
      },
    })
    render(<SceneStrip projectId="p1" />)
    expect(screen.getByText('A cat wakes up')).toBeInTheDocument()
    expect(screen.getByText('The cat stretches')).toBeInTheDocument()
  })

  it('renders an empty state with no scenes', () => {
    render(<SceneStrip projectId="p1" />)
    expect(screen.getByText('No scenes yet')).toBeInTheDocument()
  })
})
```

Create `frontend/src/components/ProjectCard.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useVidgenStore } from '../store/store'
import { ProjectCard } from './ProjectCard'

beforeEach(() => {
  useVidgenStore.setState({
    projects: { p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false } },
    eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined,
  })
})

describe('ProjectCard', () => {
  it('renders the project id and status', () => {
    render(<ProjectCard projectId="p1" />)
    expect(screen.getByText('p1')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('dispatches select on click', async () => {
    render(<ProjectCard projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(useVidgenStore.getState().selectedId).toBe('p1')
  })

  it('renders nothing for an unknown project', () => {
    render(<ProjectCard projectId="missing" />)
    expect(screen.queryByTestId('project-card-missing')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test components/SceneStrip components/ProjectCard
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write the components**

Create `frontend/src/components/SceneStrip.tsx`:

```tsx
import { useVidgenStore } from '../store/store'

interface SceneStripProps {
  projectId: string
}

export function SceneStrip({ projectId }: SceneStripProps) {
  const scenes = useVidgenStore((state) => state.projects[projectId]?.scenes ?? [])

  if (scenes.length === 0) {
    return <p className="vg-scene-strip vg-scene-strip--empty">No scenes yet</p>
  }

  return (
    <ol className="vg-scene-strip">
      {scenes.map((scene) => (
        <li key={scene.idx} className="vg-scene-strip__item">
          <strong>Scene {scene.idx + 1}</strong>
          <p>{scene.narration}</p>
          <em>{scene.visual}</em>
        </li>
      ))}
    </ol>
  )
}
```

Create `frontend/src/components/ProjectCard.tsx`:

```tsx
import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { SceneStrip } from './SceneStrip'
import { StoryboardApproval } from './StoryboardApproval'

interface ProjectCardProps {
  projectId: string
}

export function ProjectCard({ projectId }: ProjectCardProps) {
  const status = useVidgenStore((state) => state.projects[projectId]?.status)
  const select = useVidgenStore((state) => state.select)

  if (!status) {
    return null
  }

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
      <SceneStrip projectId={projectId} />
      <StoryboardApproval projectId={projectId} />
    </article>
  )
}
```

`ProjectCard` imports `StoryboardApproval`, which doesn't exist until Task 13 — that's expected and handled next.

- [ ] **Step 4: Run the new tests — expect a module-resolution failure from the `StoryboardApproval` import, not a pass yet**

```bash
bun test components/SceneStrip components/ProjectCard
```

Expected: `SceneStrip.test.tsx` FAILS to even load `ProjectCard.tsx` transitively... actually `SceneStrip.test.tsx` only imports `SceneStrip.tsx` directly and passes. `ProjectCard.test.tsx` FAILS: `Cannot find module './StoryboardApproval'`.

- [ ] **Step 5: Add a temporary stub so Task 11 is independently green (real StoryboardApproval lands in Task 13)**

Create `frontend/src/components/StoryboardApproval.tsx` as a temporary placeholder:

```tsx
interface StoryboardApprovalProps {
  projectId: string
}

// Temporary stub — replaced with the real approval-gate UI in Task 13.
export function StoryboardApproval({ projectId }: StoryboardApprovalProps) {
  void projectId
  return null
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun test components/SceneStrip components/ProjectCard
```

Expected: `5 pass` across `SceneStrip.test.tsx` + `ProjectCard.test.tsx`.

- [ ] **Step 7: Lint + commit**

```bash
bun run lint
git add src/components/SceneStrip.tsx src/components/SceneStrip.test.tsx src/components/ProjectCard.tsx src/components/ProjectCard.test.tsx src/components/StoryboardApproval.tsx
git commit -m "feat(frontend): SceneStrip + ProjectCard components (StoryboardApproval stub)"
```

---

## Task 12: `components/Board`

**Files:**
- Create: `frontend/src/components/Board.tsx`, `.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Board.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { Board } from './Board'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('Board', () => {
  it('renders the empty state with no projects', () => {
    render(<Board />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })

  it('renders a card per project', () => {
    useVidgenStore.setState({
      projects: {
        p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false },
        p2: { projectId: 'p2', status: 'scripted', scenes: [], spentUsd: 0, approved: false },
      },
    })
    render(<Board />)
    expect(screen.getByTestId('project-card-p1')).toBeInTheDocument()
    expect(screen.getByTestId('project-card-p2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun test components/Board
```

Expected: FAIL — `Cannot find module './Board'`.

- [ ] **Step 3: Write `Board.tsx`**

Create `frontend/src/components/Board.tsx`:

```tsx
import { useVidgenStore } from '../store/store'
import { ProjectCard } from './ProjectCard'

export function Board() {
  const projectIds = useVidgenStore((state) => Object.keys(state.projects))

  if (projectIds.length === 0) {
    return <p className="vg-board vg-board--empty">No projects yet</p>
  }

  return (
    <div className="vg-board">
      {projectIds.map((id) => (
        <ProjectCard key={id} projectId={id} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test components/Board
```

Expected: `2 pass` in `Board.test.tsx`.

- [ ] **Step 5: Lint + commit**

```bash
bun run lint
git add src/components/Board.tsx src/components/Board.test.tsx
git commit -m "feat(frontend): Board component"
```

---

## Task 13: `components/StoryboardApproval` — the real approval-gate UI

**Files:**
- Modify: `frontend/src/components/StoryboardApproval.tsx` (replaces the Task 11 stub)
- Create: `frontend/src/components/StoryboardApproval.test.tsx`

This is the emphasized flow from the SCOPE text: `AwaitingApproval` event → `StoryboardApproval` renders → button click → `approveStoryboard` thunk called. The three layers are each verified in their own task: `events.test.ts` (Task 4) proves `foldProject` correctly flips `status` to `'awaiting_approval'` on that event; `store.test.ts` (Task 8) proves `applyEvent`/`connect()` correctly route a live `AwaitingApproval` message into that folded state; this task's test proves the component reacts to that resulting state and dispatches the right command on click. Together they cover the full pipeline without any one test needing to fake the other two layers.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/StoryboardApproval.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useVidgenStore } from '../store/store'
import { StoryboardApproval } from './StoryboardApproval'

// bun:test has no `vi.stubGlobal`/`vi.unstubAllGlobals` — reset `fetch` to
// its real value directly so a stub set by one test can't leak into the next.
const realFetch = globalThis.fetch

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
  globalThis.fetch = realFetch
})

describe('StoryboardApproval', () => {
  it('renders nothing before the project reaches awaiting_approval', () => {
    useVidgenStore.setState({
      projects: { p1: { projectId: 'p1', status: 'scripted', scenes: [], spentUsd: 0, approved: false } },
    })
    render(<StoryboardApproval projectId="p1" />)
    expect(screen.queryByTestId('storyboard-approval')).not.toBeInTheDocument()
  })

  it('renders the contact sheet once status is awaiting_approval, and Approve dispatches approveStoryboard', async () => {
    // This state is exactly what applyEvent('vidgen.evt.p1.AwaitingApproval', {...})
    // would fold into projects.p1, per events.test.ts and store.test.ts.
    useVidgenStore.setState({
      projects: {
        p1: {
          projectId: 'p1', status: 'awaiting_approval', approved: false, spentUsd: 0,
          scenes: [{ idx: 0, narration: 'n', visual: 'v' }],
        },
      },
    })
    const fetchMock = mock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<StoryboardApproval projectId="p1" />)
    expect(screen.getByTestId('storyboard-approval')).toBeInTheDocument()
    expect(screen.getByText('n')).toBeInTheDocument() // scene narration, via SceneStrip

    await userEvent.click(screen.getByRole('button', { name: 'Approve storyboard' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/commands/ApproveStoryboard')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.projectId).toBe('p1')
  })
})
```

- [ ] **Step 2: Run tests to verify the second one fails**

```bash
bun test components/StoryboardApproval
```

Expected: the first test PASSES (the Task 11 stub already returns `null` unconditionally). The second test FAILS: `Unable to find an element with the text: Approve storyboard`.

- [ ] **Step 3: Replace the stub with the real component**

Replace `frontend/src/components/StoryboardApproval.tsx`:

```tsx
import { Button } from '../ui/Button'
import { useVidgenStore } from '../store/store'
import { SceneStrip } from './SceneStrip'

interface StoryboardApprovalProps {
  projectId: string
}

export function StoryboardApproval({ projectId }: StoryboardApprovalProps) {
  const status = useVidgenStore((state) => state.projects[projectId]?.status)
  const approveStoryboard = useVidgenStore((state) => state.approveStoryboard)

  if (status !== 'awaiting_approval') {
    return null
  }

  return (
    <section className="vg-approval" data-testid="storyboard-approval">
      <h3>Approve storyboard</h3>
      <SceneStrip projectId={projectId} />
      <Button onClick={() => void approveStoryboard({ projectId })}>Approve storyboard</Button>
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test components/StoryboardApproval
```

Expected: `2 pass` in `StoryboardApproval.test.tsx`.

- [ ] **Step 5: Run the full test suite (StoryboardApproval is now used for real by ProjectCard, Task 11) and lint**

```bash
bun test
bun run lint
```

Expected: all test files pass; lint exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/StoryboardApproval.tsx src/components/StoryboardApproval.test.tsx
git commit -m "feat(frontend): StoryboardApproval — the real approval-gate UI"
```

---

## Task 14: `src/main.tsx` + `src/App.tsx` — bootstrap, `connect()` once

**Files:**
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/assets/`

- [ ] **Step 1: Remove the demo scaffold's unused assets**

```bash
cd frontend
rm -f src/App.css src/index.css
rm -rf src/assets
```

- [ ] **Step 2: Replace `src/App.tsx`**

```tsx
import { Board } from './components/Board'
import { ConnectionStatus } from './components/ConnectionStatus'

export default function App() {
  return (
    <main className="vg-app">
      <header className="vg-app__header">
        <h1>vidgen</h1>
        <ConnectionStatus />
      </header>
      <Board />
    </main>
  )
}
```

- [ ] **Step 3: Replace `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useVidgenStore } from './store/store'

// Connect once at bootstrap — never inside a component. This is the one
// place the app opens the nats.ws event stream; the eslint local-state ban
// (Task 3) forbids side-effecting useEffect in src/components/** precisely
// so this can't happen anywhere else.
useVidgenStore
  .getState()
  .connect()
  .catch((err: unknown) => {
    console.error('failed to connect to the event stream', err)
  })

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Run the full test suite, lint, and build**

```bash
bun test
bun run lint
bun run build
```

Expected: all test files pass; lint exits 0; `✓ built in <N>ms` with no TypeScript errors (build now compiles the real `App.tsx`/`main.tsx`, not the Task 1 demo).

- [ ] **Step 5: Manual smoke check against a stub `/api` (no live api yet — P1 not authored)**

```bash
bun run dev
```

Expected: Vite prints a local URL (e.g. `http://localhost:5173/`). Opening it shows "vidgen", a "Disconnected" badge (no NATS reachable in this check), and "No projects yet" — confirms the app boots and `connect()`'s failure is caught (logged, not thrown) rather than crashing the page. Stop the dev server (`Ctrl+C`) when done.

- [ ] **Step 6: Commit**

```bash
git add -A src/App.tsx src/main.tsx
git rm src/App.css src/index.css
git rm -r src/assets
git commit -m "feat(frontend): bootstrap App/main — connect() once at entry, remove demo scaffold"
```

---

## Task 15: `frontend/Dockerfile`

**Files:**
- Create: `frontend/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `frontend/Dockerfile`:

```dockerfile
# Stage "build": compiles the SPA to static assets at /app/dist.
#
# `docker build --target build -t vidgen-frontend-build .` produces /app/dist.
# Per index §3/§5, api — not this image — serves the SPA in production:
# api's own Dockerfile (P1) is expected to `COPY --from=` this stage's
# /app/dist into whatever directory api/src/http.ts serves statically
# (ASSUMED `public/` here — confirm against api/src/http.ts once P1 is
# authored; this is a handshake point between P1 and P4, not a frozen fact).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Stage "dev": local development server, used by docker-compose's `frontend`
# service (index §2's runtime diagram). Proxies /api and /media to the api
# container per vite.config.ts's VITE_API_PROXY_TARGET (see Task 2 — set
# this env var in docker-compose.yml to api's real container DNS name/port
# once P1 defines it). Also bun-based (not node) — the dev server is started
# via `bun run dev`, which needs the `bun` binary on PATH.
FROM oven/bun:1 AS dev
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 5173
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0"]
```

- [ ] **Step 2: Verify the build stage produces static assets**

```bash
cd frontend
docker build --target build -t vidgen-frontend-build .
docker run --rm vidgen-frontend-build ls dist
```

Expected: `docker build` succeeds; `ls dist` lists at least `index.html` and an `assets/` directory.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat(frontend): Dockerfile — build stage (static dist) + dev stage (vite server)"
```

---

## Task 16: Final Verification

- [ ] `cd frontend && bun run lint` — exits 0.
- [ ] `bun run lint:prove-ban` — prints `OK: local-state ban correctly rejected the useState fixture`.
- [ ] `bun test` — all test files pass (Tasks 4, 6–13's suites: `events.test.ts`, `store.test.ts`, `Button.test.tsx`, `Badge.test.tsx`, `ConnectionStatus.test.tsx`, `CostBadge.test.tsx`, `SceneStrip.test.tsx`, `ProjectCard.test.tsx`, `Board.test.tsx`, `StoryboardApproval.test.tsx`).
- [ ] `bun run build` — succeeds, `dist/` produced, no TypeScript errors.
- [ ] `docker build --target build -t vidgen-frontend-build .` — succeeds (re-verified after Task 14's file changes).
- [ ] (User, once P1 and the docker-compose NATS service are up) `bun run dev` against a running `docker-compose` NATS container (WS on `ws://localhost:8081` per index §8) — `ConnectionStatus` shows "Live" instead of "Disconnected", confirming `natsClient.ts`'s real `wsconnect`/`jetstream` path (Task 5) actually connects, matching the `.okra/runs/disc-01/checkpoints/D3.md` evidence this plan was built on.
- [ ] (User, once P1's `api` is up) Exercise the full approval-gate flow live: dispatch `CreateProject` → ... → `RequestApproval` from a REST client, confirm `StoryboardApproval` renders in the browser, click "Approve storyboard", confirm `ApprovalGranted` arrives back over the event stream and the card updates to `approved`.

---

## Self-Review

**1. Spec coverage.**

| SCOPE item | Task(s) |
|---|---|
| 1. Scaffold `frontend/` (Vite+React+TS+Zustand+bun:test+RTL), Context7-verified APIs | Tasks 1–2 ("Context7 verification" section pins the exact confirmed facts baked into every later task) |
| 2. `eslint.config.js` flat config: local-state ban, import ban, `useRef` allowed, fixture + CI proof designed not to break normal lint | Task 3 (Steps 4–5 prove the fixture is excluded from `bun run lint`; Steps 6–8 prove `lint:prove-ban` catches a regression without touching the normal run) |
| 3. `store/events.ts` — promoted VidgenEvent/foldProject/ProjectState | Task 4 (verbatim copy + 8 fold tests covering every event type) |
| 4. `store/store.ts` — state, `applyEvent`, 7 command thunks, `connect()`/`disconnect()`, all nats.ws+fetch in store not components | Tasks 6 (state+applyEvent), 7 (thunks), 8 (connect/disconnect+singleton); `natsClient.ts` (Task 5) isolates the nats.ws wiring, still entirely inside `src/store/` |
| 5. Components: Board, ProjectCard, SceneStrip, StoryboardApproval, CostBadge, ConnectionStatus — pure, selectors only | Tasks 9 (ui primitives), 10 (ConnectionStatus, CostBadge), 11 (SceneStrip, ProjectCard), 12 (Board), 13 (StoryboardApproval) — every component test seeds state via `useVidgenStore.setState` and asserts render/dispatch only, no component holds `useState`/`useReducer`/side-effecting `useEffect` (lint-enforced, Task 10 Step 5 / Task 11 Step 7 / Task 12 Step 5 / Task 13 Step 5 all run `bun run lint`) |
| 6. `main.tsx` calls `connect()` once at bootstrap, not in a component | Task 14 |
| 7. `frontend/Dockerfile` + dev via vite proxy; prod served by api, build output path documented | Task 15; Design note 5 states the assumed `public/` handshake explicitly as unverified |
| Testing: pure fold tests, thunks w/ mocked fetch, store test with fake events + selectors, component tests, lint-ban fixture as first-class deliverable, emphasized approval-gate flow test | Task 4 (fold), Task 7 (thunks/mocked fetch), Task 6&8 (`applyEvent`/`connect` with fake `EventBusClient` and derived `projects` selector assertions), Tasks 9–13 (component tests), Task 3 (fixture), Task 13 (approval-gate: event → render → click → thunk, explicitly narrated as a 3-layer composition with Tasks 4/8) |

**2. Placeholder scan.** No `TBD`/`TODO`/"implement later" left in any code step; every code block is the complete file (or a complete replace-block with the surrounding context shown, per Task 7/8's "modify" steps). The two intentionally-flagged assumptions (api's dev proxy port in Task 2, and `api`'s static-serving directory name in Task 15) are not silent placeholders — each is a working default with an env-var override or an explicit doc note, called out in Design notes 4–5, and neither blocks any test/build/lint step in this plan from passing. `store.ts`'s Task 6 intermediate (`void deps`) is not a placeholder either — it typechecks and is genuinely superseded by Task 7's full rewrite of the same file, which is shown as complete code, not a diff.

**3. Type consistency vs index §5/§9.**
- Command thunk names (`createProject`, `generateScript`, `resolveMaterial`, `generateVoiceovers`, `requestApproval`, `approveStoryboard`, `publish`) and the `VidgenStore` state fields (`projects`, `connection: 'connecting'|'live'|'down'`, `selectedId?`) match index §9 verbatim.
- Command body shapes match index §5's table exactly: `CreateProject → { idea, durationSec, sceneCount, tone }` (Task 7's `CreateProjectInput`), `GenerateScript`/`ResolveMaterial`/`GenerateVoiceovers`/`RequestApproval`/`ApproveStoryboard → { projectId }` (`ProjectIdInput`), `Publish → { projectId, caption, privacy }` (`PublishInput`) — the `idempotencyKey` addition is called out as this plan's own transport assumption (Design note text inline in Task 7's `postCommand`), not presented as part of the frozen contract.
- `applyEvent(subject, event)` signature matches index §9 literally; Task 6's implementation genuinely uses `subject` (the format sanity-check `console.warn`), so it isn't dead-parameter noise dressed up as contract compliance.
- `StoryboardApproval`'s dispatch (`approveStoryboard({ projectId })`) uses the exact same `ProjectIdInput` shape and thunk name defined in Task 7 and exercised in Task 7's own thunk tests — no drift between the store's export and the component's call site.
- The Task 11 `StoryboardApproval` stub's props (`{ projectId: string }`) match the Task 13 real component's props exactly, so `ProjectCard`'s usage (`<StoryboardApproval projectId={projectId} />`, written once in Task 11 and never touched again) stays valid across the swap.
