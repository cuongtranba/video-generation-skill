# vidgen — Claude Code project guide

Multi-service webapp generating 9:16 Vietnamese-voiced short videos: browser idea → Agent SDK script → stock material → FPT.AI TTS → whisper captions → FFmpeg render → download/publish. Services: `api` (TypeScript/Node), `worker` (Go/ffmpeg), `frontend` (Vite/React/Zustand), `nats` (JetStream event store), `postgres` (read-model projections). Full docs in README.md.

## Architecture docs (C3)

Frozen architecture facts live in `.c3/`. The container topology is being updated via C3 change-unit `adr-20260709-webapp-topology` — see post-change-unit note: (C3 container ids will be updated after Task 6/7 apply the change-unit). Facts are frozen — they change **only** through a C3 change-unit, never by hand-editing `.c3/`.

For architecture questions, changes, audits, or file→component context → use the **C3 skill** (`/c3`). Operations: query, audit, change, ref, rule, canvas, sweep. File lookup: `c3 lookup <file-or-glob>` maps files to their owning component + governing refs/rules. `.c3/c3.db` is the CLI cache and is committed on purpose — c3 v11.3.0 cannot rebuild it from the canonical markdown (`c3 repair` fails on a seed-canvas seal), so do not delete it.

## Commands

```bash
docker compose up --build       # full stack: nats, postgres, api, worker, frontend
cd worker && go test ./...      # Go worker unit tests — must stay green
cd worker && go test -tags=integration ./internal/render/...   # real FFmpeg render (needs libass build)
cd worker && go vet ./...       # must be clean
cd api && bun test
cd frontend && bun test && bun run lint
```

## Architecture (1 minute)

- `browser (React+Zustand)` → `api` (HTTP commands + NATS event store) → `worker` (Go media jobs); event-sourced: `VIDGEN_EVENTS` (NATS JetStream) is the source of truth, Postgres is a disposable read-model projection.
- `generate` flow: `api` dispatches `vidgen.job.<kind>.<projectId>.<scene>` jobs to `worker`; idempotent at worker (output-exists check) and event-append (`Nats-Msg-Id`).
- **Cost wall**: `COST_CAP_USD` (default `0.15`) enforced in `api` aggregate — projected at `GenerateVoiceovers`, actual from `cost_ledger`. `ScriptGenerated.scriptUsd = 0` always. Never remove or weaken.
- External binaries (`ffmpeg`, `ffprobe`, `whisper`) in `worker` container by `internal/prereq`.
- Providers (`tts`/`material`/`music`) in `worker` config.

## Conventions

### Go (`worker/` only)

- Uber Go style: DI via constructors (no package-level mutable state), compile-time interface checks `var _ I = (*T)(nil)`, wrap every error with `fmt.Errorf("op %s: %w", key, err)` — no bare `return err`
- No `any`/`interface{}` for data — concrete types; `any` only as generic constraint
- Table-driven tests; external APIs mocked with `httptest`; subprocess tools faked with shell scripts in temp dirs
- TDD: write the test first, keep `go test ./...` green before commit

### TypeScript (`api/`, `frontend/`)

- No `any` or unnarrowed `unknown` — use concrete types or type-narrow before use
- `frontend/src/components/**`: ESLint local-state ban enforced — use Zustand store for shared state, not component-local `useState` for cross-component data
- TDD required: write the test first; `bun test` must be green before commit

## Gotchas (learned the hard way)

- **ffmpeg needs libass**: The `worker` container build includes `libass`. `ass=` filter in ffmpeg 8 rejects positional path when filter missing — confusing error. If building locally, use `homebrew-ffmpeg/ffmpeg/ffmpeg` tap.
- **zoompan** multiplies frames per input frame — images must enter as a single frame (no `-loop 1`), duration comes from `d=`
- **Stock clips shorter than narration** → `-stream_loop N` computed from clip duration, else black tail
- **FPT.AI TTS is async** — returns mp3 URL, must poll until HTTP 200 (5s–2min)
- **Whisper VN** word timestamps drive captions; caption lines split on >0.8s word gaps or karaoke desyncs
- **Pixabay has NO music API** and Cloudflare-blocks scraping — music comes from Jamendo (`JAMENDO_CLIENT_ID`)
- **NATS Nats-Msg-Id dedup window is 2 minutes** per index — a retry outside that window double-appends; design retries to stay within the window or accept the duplicate and handle idempotency in the aggregate

## Keys (.env, gitignored)

`FPT_TTS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` (optional), `JAMENDO_CLIENT_ID`, `TIKTOK_ACCESS_TOKEN` (publish), `COST_CAP_USD` (default `0.15`)

## Workflow

- Feature work in git worktree, branch off main, PR to merge — never push main directly
- Verify with a real render before claiming a pipeline change works: `docker compose up` then re-drive the same project through the browser re-runs at $0 (worker output-exists skip unchanged; verify via `cost_ledger` showing no new `VoiceSynthesized` charge)
