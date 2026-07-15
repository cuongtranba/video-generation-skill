# vidgen — Claude Code project guide

Event-sourced webapp generating 9:16 Vietnamese-voiced short videos: idea → script → material (stock + local uploads) → TTS → whisper captions → FFmpeg render. Three services: `api/` (TypeScript/Bun), `worker/` (Go), `frontend/` (Vite/React/Zustand) over NATS JetStream + Postgres. Full docs in README.md.

## Architecture docs (C3)

Frozen architecture facts live in `.c3/`. Facts are frozen — they change **only** through a C3 change-unit, never by hand-editing `.c3/`. For architecture questions/changes/audits/file→component lookup → use the **C3 skill** (`/c3`). `.c3/c3.db` is the CLI cache, committed on purpose — do not delete it.

> **Note:** the C3 model still describes the now-deleted legacy Go CLI. The webapp topology (api/worker/frontend + NATS + Postgres) is being re-onboarded via change-unit `adr-20260709-webapp-topology`; until it merges, `c3` code bindings point at removed paths.

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

# full stack + live render
docker compose up --build
```

## Architecture (1 minute)

- **api** appends to `VIDGEN_EVENTS` and dispatches jobs to `VIDGEN_JOBS`; command handlers in `api/src/commands.ts`, event fold in `api/src/events.ts` (`foldProject` → `ProjectState`), read-model projections in `api/src/projections.ts` → Postgres, HTTP in `api/src/http.ts` (`POST /api/commands/*`, `GET /api/state`, asset upload `POST /api/projects/:id/assets`)
- **worker** consumes jobs as idempotent handlers (`worker/internal/jobhandler`): material, tts, caption, render; emits result events (`MaterialResolved`, `VoiceSynthesized`, `CaptionsBuilt`, `RenderCompleted`, `RunFailed`)
- **Frozen event catalogue** = `api/src/events.ts` mirrored verbatim in `frontend/src/store/events.ts`. Worker event structs in `worker/internal/eventstore/events.go` and job structs in `worker/internal/jobhandler/types.go` must match the api's dispatched payload keys (`dispatchJob` does no key remapping — payload keys == worker json tags)
- **Cost wall**: `api/src/cost.ts` enforces `Σ VoiceSynthesized.ttsUsd ≤ COST_CAP_USD` (default $0.15, compose env) — projected at `GenerateVoiceovers`. Never remove or weaken
- **Script generation** is api-side via the Claude Agent SDK (`api/src/script.ts`); the SDK bundles its own runtime, auth via `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (no separate claude binary)
- **Providers** selected in `config.yaml` (mounted into worker); `tts`/`material`/`music` have `NewFromConfig` factories; keys in `.env`, validated per-selected-provider by `config.ValidateForProviders`

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
- **Render is gated on inputs**: `ApproveStoryboard` returns 400 until every scene has voiceover + material and `captionsReady` (folded from `CaptionsBuilt`). Whisper transcription takes ~2-3 min after voiceovers — approving earlier is refused
- **VoiceSynthesized carries `durationSec`** (audio length); `approveStoryboard` folds it + `MaterialResolved.assetPath` per scene to build the RenderJob (real paths, durations, `isImage` by extension). Do not revert to hardcoded `material{idx}.mp4`/`durationSec:0`
- **FPT.AI TTS** is async (poll mp3 5s–2min) and the **free tier is 429 rate-limited** — use ElevenLabs (`tts.provider: elevenlabs`) for reliable synthesis
- **ElevenLabs** uses a fixed multilingual voice ID (not the FPT voice names); `eleven_multilingual_v2` for Vietnamese
- **zoompan** for image scenes uses `durationSec` via `d=`; short stock clips loop via `-stream_loop` only when `mediaDurationSec > 0`
- **api integration tests** (`*.integration.test.ts`) need live NATS+Postgres; excluded from the unit gate

## Keys (.env, gitignored)

`FPT_TTS_API_KEY`, `ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` (optional), `JAMENDO_CLIENT_ID`. Agent SDK auth: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` (passed to the api container in compose).

## Workflow

- Verify a pipeline change with a real render before claiming success: `docker compose up`, drive create→…→approve, confirm `RenderCompleted` + `output.mp4` on the media volume, cost ≤ cap
