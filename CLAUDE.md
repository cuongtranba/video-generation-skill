# vidgen — Claude Code project guide

MIT-licensed. README carries CI, release, license, and tech-stack badges; keep them and the README's command/event tables in sync when the HTTP surface or event catalogue changes.

Event-sourced webapp generating 9:16 Vietnamese-voiced short videos: idea → script → material (stock + local uploads) → TTS (+word-timestamp sidecars) → captions → FFmpeg render. Three services: `api/` (TypeScript/Bun), `worker/` (Go), `frontend/` (Vite/React/Zustand) over NATS JetStream + Postgres. Full docs in README.md.

## Architecture docs (C3)

Frozen architecture facts live in `.c3/`. Facts are frozen — they change **only** through a C3 change-unit, never by hand-editing `.c3/`. For architecture questions/changes/audits/file→component lookup → use the **C3 skill** (`/c3`). `.c3/c3.db` is the CLI cache, committed on purpose — do not delete it.

The C3 model reflects the webapp topology (containers `c3-10` api, `c3-20` worker, `c3-30` frontend) as re-onboarded by change-unit `adr-20260715-webapp-topology`, which superseded the legacy CLI facts.

## Commands

```bash
# api (TypeScript/Bun)
cd api && bun test          # unit tests (never run *.integration.test.ts — needs live NATS+Postgres)
cd api && bun run typecheck

# worker (Go)
cd worker && go build ./...
cd worker && go test ./internal/jobhandler/... ./internal/render/...   # targeted
cd worker && go vet ./...

# frontend (Vite/React)
cd frontend && bun test
cd frontend && bun run lint        # oxlint
cd frontend && bun run typecheck

# ast-grep gates (repo root; rules/ + rule-tests/, config sgconfig.yml)
bun install                 # once — installs @ast-grep/cli
bun run test:sg             # rule self-tests (snapshots in rule-tests/__snapshots__)
bun run lint:sg             # scan: useState ban in frontend components, interface{}/any ban in worker

# full stack + live render
docker compose up --build
```

**Release.** Versioning is automated by release-please (single root: `release-type: simple`, config `release-please-config.json` + `.release-please-manifest.json`, workflow `.github/workflows/release-please.yml`). Land Conventional Commits on `main`; a Release PR bumps the version + `CHANGELOG.md`; merging it tags `vX.Y.Z` + a GitHub Release. `feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE:` → major.

CI (`.github/workflows/test.yml`) runs four jobs on push/PR to main: ast-grep (rule tests + scan), api (typecheck + `bun test` — integration suites self-skip without NATS/Postgres), worker (`go build`/`vet`/`test ./...`), frontend (oxlint, typecheck, `bun test`, vite build).

## Architecture (1 minute)

- **api** appends to `VIDGEN_EVENTS` and dispatches jobs to `VIDGEN_JOBS`; command handlers in `api/src/commands.ts`, event fold in `api/src/events.ts` (`foldProject` → `ProjectState`), read-model projections in `api/src/projections.ts` → Postgres, HTTP in `api/src/http.ts` (`POST /api/commands/*`, `GET /api/state`, `GET /api/config` → `{ ttsProvider }`, asset upload `POST /api/projects/:id/assets`)
- **worker** consumes jobs as idempotent handlers (`worker/internal/jobhandler`): material, tts, caption, render; emits result events (`MaterialResolved`, `VoiceSynthesized`, `CaptionsBuilt`, `RenderCompleted`, `RunFailed`)
- **Frozen event catalogue** = `api/src/events.ts` mirrored verbatim in `frontend/src/store/events.ts`. Worker event structs in `worker/internal/eventstore/events.go` and job structs in `worker/internal/jobhandler/types.go` must match the api's dispatched payload keys (`dispatchJob` does no key remapping — payload keys == worker json tags)
- **Cost wall**: `api/src/cost.ts` enforces `Σ VoiceSynthesized.ttsUsd ≤ COST_CAP_USD` (default $0.15, compose env) — projected at `GenerateVoiceovers`. Never remove or weaken
- **Script generation** is api-side via the Claude Agent SDK (`api/src/script.ts`); the SDK bundles its own runtime, auth via `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (no separate claude binary)
- **Providers** selected in `config.yaml` (mounted into worker **and** api — `CONFIG_PATH`); `tts`/`material`/`music` have `NewFromConfig` factories; keys in `.env`, validated per-selected-provider by `config.ValidateForProviders`. The api reads `tts.provider` (`api/src/config.ts`, `Bun.YAML.parse`) and serves it at `GET /api/config`; the SPA renders a read-only "ElevenLabs (fixed)" label in TunePanel instead of a voice/speed picker

## Conventions

- **Go** (worker): Uber style — DI via constructors, `var _ I = (*T)(nil)`, wrap every error `fmt.Errorf("op: %w", err)`, no `any`/`interface{}` for data, table-driven tests, `httptest` for external APIs
- **TypeScript** (api/frontend): no `any`; narrowed `unknown` only at boundaries; concrete types
- TDD: test first, keep the targeted unit suites green before commit
- `git worktree` for feature work, branch off main, PR to merge — never push main directly

### TypeScript (`api/`, `frontend/`)

- No `any` or unnarrowed `unknown` — use concrete types or type-narrow before use
- `frontend/src/components/**`: ESLint local-state ban enforced — use Zustand store for shared state, not component-local `useState` for cross-component data
- TDD required: write the test first; `bun test` must be green before commit

## Gotchas (learned the hard way)

- **ffmpeg needs libass**: worker image installs a libass-capable ffmpeg; the `ass=` filter fails with "Could not create a libass track" if `captions.ass` is missing/unreadable
- **Render is gated on inputs**: `ApproveStoryboard` returns 400 until every scene has voiceover + material and `captionsReady` (folded from `CaptionsBuilt`). Captions land within seconds of the last voiceover — approving earlier is refused
- **VoiceSynthesized carries `durationSec`** (audio length); `approveStoryboard` folds it + `MaterialResolved.assetPath` per scene to build the RenderJob (real paths, durations, `isImage` by extension). Do not revert to hardcoded `material{idx}.mp4`/`durationSec:0`
- **ElevenLabs is the only TTS provider** (FPT.AI removed). Synthesis is synchronous and uses a **fixed voice ID** (override per-deploy with `ELEVENLABS_VOICE_ID`); the `voice`/`speed` tune fields exist in the event model but are not applied — the SPA shows a read-only "ElevenLabs (fixed)" label instead of a picker. `eleven_turbo_v2_5` for Vietnamese (override `ELEVENLABS_MODEL_ID`)
- **Captions come from ElevenLabs `/with-timestamps`**: synthesis returns word timings alongside the audio; the tts step writes a `tts{idx}.words.json` sidecar next to each mp3 and the caption handler reads it (no transcription step, no CPU-bound wait). `captionsReady` now lands right after the last voiceover. If a sidecar is missing (e.g. audio synthesized before this change), the caption job fails loudly rather than guessing timings — re-run voiceovers to regenerate the sidecars.
- **zoompan** for image scenes uses `durationSec` via `d=`; short stock clips loop via `-stream_loop` only when `mediaDurationSec > 0`
- **api integration tests** (`*.integration.test.ts`) need live NATS+Postgres; excluded from the unit gate
- **Pipeline rail tiles must FLEX, never a fixed `width`**: the Pipeline Home rail (`.vg-node` in `frontend/src/styles/app.css`) lays out all six stages (SCRIPT→…→RENDER) in one row. Fixed-width tiles overflow the 960px shell and `overflow-x` silently clips the final RENDER node (no scroll affordance) — a real "hidden UI" bug. Tiles use `flex: 1 1 0` + a `min-width` floor so they always fit; below the floor the rail scrolls. Enforced by `frontend/src/styles/pipeline-rail-fit.test.ts` (fails the frontend `bun test` gate if a fixed pixel width returns to a rail tile). happy-dom computes no layout, so the guard checks the CSS source

## Keys (.env, gitignored)

`ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` (optional), `JAMENDO_CLIENT_ID`. Agent SDK auth: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (passed to the api container in compose).

## Workflow

- Verify a pipeline change with a real render before claiming success: `docker compose up`, drive create→…→approve, confirm `RenderCompleted` + `output.mp4` on the media volume, cost ≤ cap
