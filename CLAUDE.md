# vidgen — Claude Code project guide

Go CLI generating 9:16 Vietnamese-voiced short videos: idea → script → stock material → FPT.AI TTS → whisper captions → FFmpeg render. Full docs in README.md.

## Architecture docs (C3)

Frozen architecture facts live in `.c3/`: system `c3-0`, containers `c3-1` (CLI process) and `c3-2` (message-bus/async plane), 14 components, plus governing refs and rules. Facts are frozen — they change **only** through a C3 change-unit, never by hand-editing `.c3/`.

For architecture questions, changes, audits, or file→component context → use the **C3 skill** (`/c3`). Operations: query, audit, change, ref, rule, canvas, sweep. File lookup: `c3 lookup <file-or-glob>` maps files to their owning component + governing refs/rules. `.c3/c3.db` is the CLI cache and is committed on purpose — c3 v11.3.0 cannot rebuild it from the canonical markdown (`c3 repair` fails on a seed-canvas seal), so do not delete it.

## Commands

```bash
go build -o vidgen ./cmd/vidgen        # build
go test ./...                          # unit tests — must stay green
go test -tags=integration ./internal/render/...   # real FFmpeg render (needs libass build)
go vet ./...                           # must be clean
```

## Architecture (1 minute)

- `cmd/vidgen` → `internal/cli` (cobra) → `internal/flow` (status machine: draft→material→tuned→confirmed→rendered→published)
- Project state = JSON manifest at `~/.vidgen/projects/<id>/manifest.json`; all assets co-located; every step saves + is resumable
- `generate` runs an **embedded NATS JetStream** bus (`internal/bus`) with idempotent workers (`internal/worker`): parallel per-scene TTS, then caption, then render. Worker checks output file exists → skips work (safe re-run)
- **Cost wall**: `internal/cost` enforces $0.10/video — projected at confirm, actual during generate. Never remove or weaken these checks
- External binaries resolved by `internal/prereq` (env overrides: FFMPEG_BIN, FFPROBE_BIN, WHISPER_BIN, CLAUDE_BIN)
- Providers selected via `~/.vidgen/config.yaml` (`config.LoadProviders`); each category package (`tts`/`music`/`material`/`publish`) has a `NewFromConfig` factory; `videogen` is an interface seam. Keys stay in `.env`, validated per-selected-provider by `config.ValidateForProviders`

## Conventions

- Uber Go style: DI via constructors (no package-level mutable state), compile-time interface checks `var _ I = (*T)(nil)`, wrap every error with `fmt.Errorf("op %s: %w", key, err)` — no bare `return err`
- No `any`/`interface{}` for data — concrete types; `any` only as generic constraint
- Table-driven tests; external APIs mocked with `httptest`; subprocess tools faked with shell scripts in temp dirs
- TDD: write the test first, keep `go test ./...` green before commit

## Gotchas (learned the hard way)

- **ffmpeg needs libass**: Homebrew core formula dropped subtitle filters; use `homebrew-ffmpeg/ffmpeg/ffmpeg` tap. `ass=` filter in ffmpeg 8 rejects positional path when filter missing — confusing error
- **claude CLI json output** is an ARRAY of messages in current versions; `script.parseEnvelope` handles both shapes
- **zoompan** multiplies frames per input frame — images must enter as a single frame (no `-loop 1`), duration comes from `d=`
- **Stock clips shorter than narration** → `-stream_loop N` computed from clip duration, else black tail
- **FPT.AI TTS is async** — returns mp3 URL, must poll until HTTP 200 (5s–2min)
- **Whisper VN** word timestamps drive captions; caption lines split on >0.8s word gaps or karaoke desyncs
- **Pixabay has NO music API** and Cloudflare-blocks scraping — music comes from Jamendo (`JAMENDO_CLIENT_ID`)

## Keys (.env, gitignored)

`FPT_TTS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` (optional), `JAMENDO_CLIENT_ID`, `TIKTOK_ACCESS_TOKEN` (publish)

## Workflow

- Feature work in git worktree, branch off main, PR to merge — never push main directly
- Verify with a real render before claiming a pipeline change works: `./vidgen generate` on an existing project re-runs at $0 (idempotent TTS)
