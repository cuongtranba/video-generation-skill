# P3 — Go worker event-store adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing in-process, embedded-NATS Go workers (`internal/worker` + `internal/bus`) into a standalone `worker/` service: a new Go module that connects to the shared JetStream deployment, consumes `VIDGEN_JOBS` (`vidgen.job.<kind>.<projectId>.<scene>`), runs the kept ffmpeg/whisper/FPT.AI media packages, and appends typed result events to `VIDGEN_EVENTS` (`vidgen.evt.<projectId>.<type>`) with `Nats-Msg-Id`-based idempotency — replacing the old output-file-exists correctness boundary.

**Architecture:** A brand-new nested Go module `worker/` (own `go.mod`, module path `github.com/cuongtranba/video-generation-skill/worker`) is scaffolded by **copying** (not moving) the 8 self-contained "kept" packages (`tts`, `material`, `caption`, `render`, `music`, `domain`, `prereq`, `config`) out of the root module's `internal/` into `worker/internal/`, with import paths rewritten to the new module path. A new `worker/internal/eventstore` package owns all JetStream I/O (`Connect`, `ConsumeJobs`, `PublishResult`, the 5 worker-owned typed events). A new `worker/internal/jobhandler` package adapts job payloads to the kept media packages and turns their results into typed events (or a `RunFailed` event on error). `worker/cmd/worker/main.go` wires it all together with graceful shutdown. The root module (`cmd/vidgen`, `internal/cli`, `internal/flow`, `internal/worker`, `internal/bus`, and the original `internal/{tts,material,caption,render,music,domain,prereq,config}`) is left **completely untouched** by this plan — it keeps building and testing exactly as before, since P5 (last, out of scope here) is the plan that deletes the CLI and any now-redundant root duplicates once the webapp fully replaces it.

**Tech Stack:** Go 1.25, `github.com/nats-io/nats.go` v1.52.0 (`jetstream` subpackage), `github.com/google/uuid`, `gopkg.in/yaml.v3`. Verified live against the running dev NATS at `nats://localhost:4223` (container `webapp-rewrite-nats-1`), which already has the `VIDGEN_EVENTS` and `VIDGEN_JOBS` streams (confirmed via `/jsz?streams=true`: `VIDGEN_EVENTS` created, `VIDGEN_JOBS` created, both currently empty/near-empty) — this plan's tests append to and consume from those real streams, they do not create them (stream creation is owned by `api`, P1).

---

## Ground truth this plan is bound by (frozen, do not redefine)

From `docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md`:
- **§3 layout:** `worker/cmd/worker/main.go`, `worker/internal/eventstore/` (NEW), `worker/internal/{tts,material,caption,render,music,domain,prereq}/` (KEPT, re-pointed), `worker/go.mod`, `worker/Dockerfile`.
- **§4 event/job contract:** `VIDGEN_EVENTS` subjects `vidgen.evt.<projectId>.<type>`; `VIDGEN_JOBS` subjects `vidgen.job.<kind>.<projectId>.<scene>`, `<kind> ∈ {material,tts,caption,render}`; event catalogue fields frozen in `spikes/event-model/events.ts` (verbatim field names: `v`, `type`, `projectId`, `at`, plus per-type fields); msgID scheme `<type>-<projectId>-<sceneIdx|'-'>`.
- **§7 Go imports:** `github.com/nats-io/nats.go` + `/jetstream`; `js.Publish(ctx, subj, data, jetstream.WithMsgID(id))`; `jetstream.OrderedConsumerConfig{FilterSubjects}`; tune `FetchMaxWait` low.
- **§8 runtime env:** host NATS TCP is remapped to `4223` (compose DNS `nats:4222` inside containers); this plan's tests use the host port since they run outside compose.
- From `spikes/go-worker/main.go` + `.okra/runs/disc-01/checkpoints/D4.md`: `js.Publish` / `WithMsgID` / `OrderedConsumer` / `Fetch` signatures verified against Context7 `/nats-io/nats.go` docs with **no deviations**; the one runtime finding is that `Fetch(n)` against fewer than `n` available messages blocks for the default ~30s max-wait — production code must pass `jetstream.FetchMaxWait(...)` tuned low. Verified independently against the installed module (`nats.go@v1.52.0`): `jetstream.ConsumerConfig.FilterSubjects []string` exists (mutually exclusive with singular `FilterSubject`); `Consumer.Fetch(batch int, opts ...FetchOpt) (MessageBatch, error)`; a natural per-fetch timeout with zero messages does **not** populate `batch.Error()` (confirmed by reading `jetstream/pull.go`'s `fetch()` — `nats.ErrTimeout`/`ErrNoMessages` are explicitly excluded from `res.err`), so the idle-poll loop in `ConsumeJobs` never spuriously errors out.

## Design decisions this plan makes (not pinned elsewhere — flagged for the reader and for P1/P5 authors)

1. **Module strategy — new standalone nested module, NOT a `go.work` workspace.** `worker/go.mod` declares `module github.com/cuongtranba/video-generation-skill/worker`. Go natively excludes a directory containing its own `go.mod` from the parent module's package tree, so root's `go build ./...` / `go test ./...` do not descend into `worker/` and vice versa — no `go.work` file is needed for the two modules to coexist in one repo. **Why not `go.work`:** a workspace only helps when two modules share the *same* source files via local `replace`-style resolution; here §3's frozen layout puts the kept packages bodily under `worker/internal/`, a different physical location than root's `internal/`, so there is nothing to "workspace" — it's a copy, not a cross-module reference.
2. **Copy, don't move, the kept packages.** The 8 packages are **copied** from root `internal/` into `worker/internal/`, not `git mv`'d. Root's `internal/cli` and `internal/flow` (25 references across `internal/cli/publish.go`, `internal/cli/root.go`, `internal/flow/flow.go`, `internal/flow/flow_test.go`, `internal/flow/generate.go`) still import the *original* root packages and must keep compiling — P5 is explicitly "last" in the dependency graph and owns deleting `cmd/vidgen` + `internal/cli`; only then do the root duplicates become dead and get removed. Doing a physical move here would break root's `go test ./...` for the entire P3→P5 window, violating "never leave things broken." Verified empirically (Task 1) that the closed set of internal deps among these 8 packages is exactly `{config, domain}` (no package outside the 8 is pulled in), so the copy is self-contained.
3. **`internal/config` is copied too, even though the index's kept-package list (§3) only names `tts,material,caption,render,music,domain,prereq`.** `tts.NewFromConfig`, `material.NewFromConfig`, and `music.NewFromConfig` all take a `config.ProvidersConfig` / `config.Config` argument — the index's list is the set of *category* packages, not an exhaustive transitive-dependency list. Without `config`, the worker cannot select providers at all. Flagged here since it's an addition to the frozen file list, not a contradiction of it.
4. **`worker/internal/eventstore` does not call `EnsureStreams`.** Stream creation/configuration for `VIDGEN_EVENTS`/`VIDGEN_JOBS` is owned by `api` (P1, per the spec's command-flow description). The worker only publishes/consumes; this plan's tests rely on the streams already existing on the dev NATS instance (confirmed present).
5. **`RunFailed.MsgID()` extends the frozen 3-part template with `stage`.** The literal `<type>-<projectId>-<sceneIdx|'-'>` template, applied verbatim to `RunFailed` (which has no `sceneIdx` JSON field at all — see `spikes/event-model/events.ts`), would produce the *same* msgID for two different failing stages of the same project within the 2-minute dedup window (e.g. `material` job for scene 2 fails, then `tts` job for scene 4 fails — both would collapse to `RunFailed-proj1-`), silently dropping the second failure. Since **msgID is a NATS header, not a JSON wire field**, extending it with `stage` does not touch the frozen JSON schema (§4's "field name parity" requirement is about the event catalogue's JSON body, which is untouched) and directly fulfills §4's own stated goal — "deterministic per logical fact." `RunFailed` therefore carries an unexported-from-JSON `SceneIdx int` field (`json:"-"`, `-1` = project-scoped stage) used only to compute `MsgID()`.
6. **`CaptionsBuilt.sceneIdx` is always `0`.** The kept `caption.ASSWriter`/`CaptionWorker.handle` behavior (unchanged, `internal/worker/worker.go:169-199`) merges all scenes' word timestamps into **one** ASS file per project — there is no per-scene caption artifact today. The frozen event schema has a `sceneIdx` field (presumably for a future per-scene caption pipeline), so this worker populates it with the constant `0` rather than omitting it, and documents the convention here. This does not create a dedup hazard since at most one caption job ever runs per project.
7. **Job payload JSON contract (subject bodies) is defined by this plan**, since P1 (which will produce these payloads) is not yet authored and the index doc only fixes the *subjects*, not the *bodies*. All job payload structs live in `worker/internal/jobhandler` with camelCase JSON tags (`projectId`, `sceneIdx`, `destPath`, ...) to match the rest of the webapp's JSON convention (the event catalogue is camelCase). **Known, accepted inconsistency:** `domain.CaptionStyle` (copied verbatim, unmodified per decision #2) has pre-existing `snake_case` JSON tags (`font_name`, `font_size`, ...) — embedding it in `CaptionJob` means the top-level job is camelCase but the nested `style` object is snake_case. Not fixed here because `domain` is a KEPT, re-pointed-only package; flagged for P1's author to know when serializing `CaptionJob.style` from the TS side.
8. **Rendered/media output path convention.** Job payloads carry absolute `destPath`/`outputPath` values (the worker never invents paths); this plan assumes (and the compose service in Task 13 provisions) a shared named volume `vidgen-media` mounted at `/data/media` in the `worker` container, so that whatever paths `api` (P1) puts into job payloads resolve inside the worker's filesystem and are later served by `api`'s `GET /media/<projectId>/<file>` route from the same volume. This is a new cross-plan volume-name contract this plan introduces (not present in the frozen index) — **P1's compose/service definition must mount the same `vidgen-media` volume at the same path** for `outputPath`/`mp3Path`/`assPath`/`assetPath` values written by the worker to be readable by `api`.
9. **Error handling: domain failures are terminal, not retried.** A media-processing error (e.g. "no material found for query") is captured as a `RunFailed` event and the handler then returns `nil` (ack, no redelivery) — the failure is a valid, durably-recorded terminal state, not a transient fault. Only an error *publishing to NATS itself* (nothing was durably recorded) propagates up and causes a `Nak` (redelivery), since retrying is safe and necessary there. This is a deliberate change from `internal/bus.ConsumeJSON`'s blanket "any handler error → Nak" policy, justified because every event this worker publishes carries a deterministic msgID, so even an accidental retry of a job whose failure was already recorded is a no-op dedup, not a duplicate.

---

## 1. Target file structure

```
worker/
  go.mod
  go.sum                              # generated by `go mod tidy`
  Dockerfile
  cmd/worker/
    main.go
  internal/
    eventstore/
      store.go                        # Store, Connect, Close, PublishResult, stream/subject consts
      store_test.go
      events.go                       # Event interface + 5 typed event structs (worker-owned subset)
      events_test.go
      jobs.go                         # JobHandler[T], ConsumeJobs[T]
      jobs_test.go
    jobhandler/
      types.go                        # job payload structs (MaterialJob, TTSJob, CaptionJob, RenderJob, ...)
      failure.go                      # publishFailure shared helper
      material.go                     # MaterialHandler
      material_test.go
      tts.go                          # TTSHandler
      tts_test.go
      caption.go                      # CaptionHandler
      caption_test.go
      render.go                       # RenderHandler
      render_test.go
    tts/            # copied from root internal/tts, import path rewritten
    material/       # copied from root internal/material, import path rewritten
    caption/        # copied from root internal/caption, import path rewritten
    render/         # copied from root internal/render, import path rewritten
    music/          # copied from root internal/music, import path rewritten
    domain/         # copied from root internal/domain, import path rewritten
    prereq/         # copied from root internal/prereq, import path rewritten
    config/         # copied from root internal/config, import path rewritten
```

`docker-compose.yml` (repo root, exists) gets a new `worker` service (Task 13).

---

## Task 1: Scaffold the `worker/` Go module and copy the kept packages

**Files:**
- Create: `worker/go.mod`
- Create (copy): `worker/internal/tts/*.go`, `worker/internal/material/*.go`, `worker/internal/caption/*.go`, `worker/internal/render/*.go`, `worker/internal/music/*.go`, `worker/internal/domain/*.go`, `worker/internal/prereq/*.go`, `worker/internal/config/*.go` (including every `*_test.go` in each package)

- [ ] **Step 1: Create the worker module directory and go.mod**

Run:
```bash
mkdir -p /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker/cmd/worker
```

Create `worker/go.mod`:

```go
module github.com/cuongtranba/video-generation-skill/worker

go 1.25.5

require (
	github.com/google/uuid v1.6.0
	github.com/nats-io/nats.go v1.52.0
	gopkg.in/yaml.v3 v3.0.1
)
```

- [ ] **Step 2: Copy the 8 kept packages (including their tests) into worker/internal/**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
for pkg in tts material caption render music domain prereq config; do
  mkdir -p "worker/internal/$pkg"
  cp internal/"$pkg"/*.go "worker/internal/$pkg/"
done
```

Expected: `worker/internal/{tts,material,caption,render,music,domain,prereq,config}/` each contain the same `.go` files (prod + `_test.go`) as the corresponding root `internal/*` directory. Verify counts match:

```bash
for pkg in tts material caption render music domain prereq config; do
  a=$(find internal/"$pkg" -maxdepth 1 -name '*.go' | wc -l)
  b=$(find worker/internal/"$pkg" -maxdepth 1 -name '*.go' | wc -l)
  echo "$pkg: root=$a worker=$b"
done
```
Expected output: every line reads `<pkg>: root=N worker=N` (equal counts) — `tts: root=4 worker=4`, `material: root=6 worker=6`, `caption: root=4 worker=4`, `render: root=4 worker=4`, `music: root=4 worker=4`, `domain: root=2 worker=2`, `prereq: root=2 worker=2`, `config: root=4 worker=4`.

- [ ] **Step 3: Rewrite the copied files' import paths from the root module to the worker module**

Run (macOS/BSD `sed`, matches this repo's platform):
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
find worker/internal -name '*.go' -exec sed -i '' \
  's#github.com/cuongtranba/video-generation-skill/internal/#github.com/cuongtranba/video-generation-skill/worker/internal/#g' \
  {} +
```

Verify no old-style import paths remain inside `worker/`:
```bash
grep -rn '"github.com/cuongtranba/video-generation-skill/internal/' worker/ || echo "clean"
```
Expected: `clean`.

- [ ] **Step 4: go mod tidy and build the copied packages**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
go mod tidy
go build ./...
```
Expected: exits 0, no output (or only `go: downloading ...` lines on first run). `worker/go.sum` is created/updated.

- [ ] **Step 5: Run the copied packages' own tests — this is the "drift gauge" (100% pass rate required)**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
go test ./internal/tts/... ./internal/material/... ./internal/caption/... ./internal/render/... ./internal/music/... ./internal/domain/... ./internal/prereq/... ./internal/config/...
```
Expected: `ok` for every package, e.g.:
```
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/tts	0.4s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/material	0.3s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/caption	0.2s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/render	0.3s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/music	0.2s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/domain	0.1s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/prereq	0.1s
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/config	0.1s
```
`internal/render`'s `renderer_integration_test.go` is `//go:build integration`-gated (unchanged from root) and is **not** run by this command — matches the root project's own convention (see root `CLAUDE.md`: `go test -tags=integration ./internal/render/...` is a separate, explicit command). If any package fails here, STOP — this is drift introduced by the copy (e.g. a stray absolute import), not a pre-existing issue, and must be fixed before continuing (do not silently patch test expectations).

- [ ] **Step 6: Confirm the root module is untouched**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
go test ./... 2>&1 | tail -20
```
Expected: identical results to a pre-Task-1 baseline run (all root packages still `ok`; `worker/` does not appear in the package list at all, since Go excludes nested modules automatically).

- [ ] **Step 7: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/go.mod worker/go.sum worker/internal/tts worker/internal/material worker/internal/caption worker/internal/render worker/internal/music worker/internal/domain worker/internal/prereq worker/internal/config
git commit -m "worker: scaffold standalone Go module, copy kept media packages"
```

---

## Task 2: `eventstore.Store` — Connect and Close

**Files:**
- Create: `worker/internal/eventstore/store.go`
- Test: `worker/internal/eventstore/store_test.go`

- [ ] **Step 1: Write the failing test**

```go
// worker/internal/eventstore/store_test.go
package eventstore

import "testing"

func TestConnect(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer s.Close()
	if s.js == nil {
		t.Fatal("Connect returned a Store with a nil JetStream context")
	}
}

func TestConnect_BadURL(t *testing.T) {
	_, err := Connect("nats://localhost:1")
	if err == nil {
		t.Fatal("Connect to an unreachable address: want error, got nil")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run TestConnect -v`
Expected: FAIL — `package eventstore` has no `Connect` / `Store` (build failure).

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/eventstore/store.go
package eventstore

import (
	"fmt"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	// StreamEvents is the append-only source-of-truth event log (owned by
	// api/P1; this package only reads/writes to it, never creates it).
	StreamEvents = "VIDGEN_EVENTS"
	// StreamJobs is the work-queue stream api dispatches jobs onto.
	StreamJobs = "VIDGEN_JOBS"

	eventSubjectPrefix = "vidgen.evt"
	jobSubjectPrefix   = "vidgen.job"
)

// JobKind identifies which pipeline stage a job/consumer belongs to.
type JobKind string

const (
	KindMaterial JobKind = "material"
	KindTTS      JobKind = "tts"
	KindCaption  JobKind = "caption"
	KindRender   JobKind = "render"
)

// Store is the worker's only channel to the shared NATS JetStream
// deployment: no direct DB access, per the frozen "no DB coupling" rule
// (docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md §4/D4).
type Store struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// Connect dials url (compose DNS "nats://nats:4222" in production,
// "nats://localhost:4223" for local dev against the running docker-compose
// stack — §8 of the index) and binds a JetStream context to it.
func Connect(url string) (*Store, error) {
	nc, err := nats.Connect(url)
	if err != nil {
		return nil, fmt.Errorf("connect nats %s: %w", url, err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("create jetstream context for %s: %w", url, err)
	}

	return &Store{nc: nc, js: js}, nil
}

// Close releases the underlying NATS connection.
func (s *Store) Close() {
	s.nc.Close()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run TestConnect -v`
Expected:
```
=== RUN   TestConnect
--- PASS: TestConnect (0.0Xs)
=== RUN   TestConnect_BadURL
--- PASS: TestConnect_BadURL (0.0Xs)
PASS
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/eventstore	0.0Xs
```
(Requires the dev NATS container `webapp-rewrite-nats-1` to be running and reachable on host port `4223` — confirmed running via `docker ps` before writing this plan. If it is down, `docker compose up -d nats` from the repo root first.)

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/eventstore/store.go worker/internal/eventstore/store_test.go
git commit -m "worker/eventstore: add Store.Connect/Close"
```

---

## Task 3: Typed events (worker-owned subset) — `Event` interface + 5 structs

**Files:**
- Create: `worker/internal/eventstore/events.go`
- Test: `worker/internal/eventstore/events_test.go`

This worker publishes only the 5 event types it is the sole producer of: `MaterialResolved`, `VoiceSynthesized`, `CaptionsBuilt`, `RenderCompleted`, `RunFailed`. The other 6 catalogue types (`ProjectCreated`, `ScriptGenerated`, `CostProjected`, `AwaitingApproval`, `ApprovalGranted`, `Published`) are appended by `api` (P1) and are out of this plan's scope.

- [ ] **Step 1: Write the failing tests**

```go
// worker/internal/eventstore/events_test.go
package eventstore

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, ev Event) string {
	t.Helper()
	data, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("marshal %T: %v", ev, err)
	}
	return string(data)
}

func TestMaterialResolved(t *testing.T) {
	ev := NewMaterialResolved("proj1", 2, "pexels", "/data/media/proj1/scene-2.mp4")

	if got, want := ev.Subject(), "vidgen.evt.proj1.MaterialResolved"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "MaterialResolved-proj1-2"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"MaterialResolved"`, `"projectId":"proj1"`,
		`"sceneIdx":2`, `"source":"pexels"`, `"assetPath":"/data/media/proj1/scene-2.mp4"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestVoiceSynthesized(t *testing.T) {
	ev := NewVoiceSynthesized("proj1", 1, "/data/media/proj1/scene-1.mp3", 0.00042)

	if got, want := ev.Subject(), "vidgen.evt.proj1.VoiceSynthesized"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "VoiceSynthesized-proj1-1"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"VoiceSynthesized"`, `"projectId":"proj1"`,
		`"sceneIdx":1`, `"mp3Path":"/data/media/proj1/scene-1.mp3"`, `"ttsUsd":0.00042`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestCaptionsBuilt(t *testing.T) {
	ev := NewCaptionsBuilt("proj1", "/data/media/proj1/captions.ass")

	if got, want := ev.Subject(), "vidgen.evt.proj1.CaptionsBuilt"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "CaptionsBuilt-proj1-0"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"CaptionsBuilt"`, `"projectId":"proj1"`,
		`"sceneIdx":0`, `"assPath":"/data/media/proj1/captions.ass"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestRenderCompleted(t *testing.T) {
	ev := NewRenderCompleted("proj1", "/data/media/proj1/out.mp4", 0.0)

	if got, want := ev.Subject(), "vidgen.evt.proj1.RenderCompleted"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "RenderCompleted-proj1-"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"RenderCompleted"`, `"projectId":"proj1"`,
		`"outputPath":"/data/media/proj1/out.mp4"`, `"renderUsd":0`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestRunFailed(t *testing.T) {
	sceneFail := NewRunFailed("proj1", "material", 2, errors.New("no material found"))
	projectFail := NewRunFailed("proj1", "render", -1, errors.New("ffmpeg exit 1"))

	if got, want := sceneFail.Subject(), "vidgen.evt.proj1.RunFailed"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := sceneFail.MsgID(), "RunFailed-proj1-material-2"; got != want {
		t.Errorf("scene-scoped MsgID() = %q, want %q", got, want)
	}
	if got, want := projectFail.MsgID(), "RunFailed-proj1-render-"; got != want {
		t.Errorf("project-scoped MsgID() = %q, want %q", got, want)
	}

	// two different stages failing for the same project must NOT collide
	otherStageFail := NewRunFailed("proj1", "tts", -1, errors.New("FPT timeout"))
	if projectFail.MsgID() == otherStageFail.MsgID() {
		t.Fatalf("distinct stages produced the same MsgID %q — would dedup-collide", projectFail.MsgID())
	}

	data := mustJSON(t, sceneFail)
	for _, want := range []string{
		`"v":1`, `"type":"RunFailed"`, `"projectId":"proj1"`,
		`"stage":"material"`, `"error":"no material found"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
	if strings.Contains(data, `sceneIdx`) {
		t.Errorf("JSON %s must not contain sceneIdx (not part of the frozen RunFailed schema): %s", data, data)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run 'TestMaterialResolved|TestVoiceSynthesized|TestCaptionsBuilt|TestRenderCompleted|TestRunFailed' -v`
Expected: FAIL — build failure, no `Event`/`NewMaterialResolved`/etc. defined yet.

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/eventstore/events.go
package eventstore

import (
	"fmt"
	"time"
)

// scenelessMarker is the literal "-" the frozen id scheme
// (index §4: "<type>-<projectId>-<sceneIdx|'-'>") uses for events that are
// not scoped to a single scene.
const scenelessMarker = "-"

// Event is implemented by every concrete event struct this worker publishes.
// Subject and MsgID are derived from the event's own fields so callers never
// hand-build subject strings or dedup keys — this is what makes
// eventstore.PublishResult's msgID handling correct by construction.
type Event interface {
	Subject() string
	MsgID() string
}

func eventSubject(projectID, eventType string) string {
	return fmt.Sprintf("%s.%s.%s", eventSubjectPrefix, projectID, eventType)
}

func sceneMsgID(eventType, projectID string, sceneIdx int) string {
	return fmt.Sprintf("%s-%s-%d", eventType, projectID, sceneIdx)
}

func projectMsgID(eventType, projectID string) string {
	return fmt.Sprintf("%s-%s-%s", eventType, projectID, scenelessMarker)
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// MaterialResolved reports that scene SceneIdx's stock/local media has been
// resolved and downloaded to AssetPath. Field names mirror
// spikes/event-model/events.ts exactly (frozen contract, index §4).
type MaterialResolved struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	SceneIdx  int    `json:"sceneIdx"`
	Source    string `json:"source"`
	AssetPath string `json:"assetPath"`
}

func NewMaterialResolved(projectID string, sceneIdx int, source, assetPath string) MaterialResolved {
	return MaterialResolved{
		V: 1, Type: "MaterialResolved", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: sceneIdx, Source: source, AssetPath: assetPath,
	}
}

func (e MaterialResolved) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e MaterialResolved) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// VoiceSynthesized reports that scene SceneIdx's voiceover was synthesized
// to MP3Path, at a metered cost of TTSUsd.
type VoiceSynthesized struct {
	V         int     `json:"v"`
	Type      string  `json:"type"`
	ProjectID string  `json:"projectId"`
	At        string  `json:"at"`
	SceneIdx  int     `json:"sceneIdx"`
	MP3Path   string  `json:"mp3Path"`
	TTSUsd    float64 `json:"ttsUsd"`
}

func NewVoiceSynthesized(projectID string, sceneIdx int, mp3Path string, ttsUsd float64) VoiceSynthesized {
	return VoiceSynthesized{
		V: 1, Type: "VoiceSynthesized", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: sceneIdx, MP3Path: mp3Path, TTSUsd: ttsUsd,
	}
}

func (e VoiceSynthesized) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e VoiceSynthesized) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// CaptionsBuilt reports that the project's ASS caption file was written to
// ASSPath. SceneIdx is always 0 — see plan decision #6: the kept caption
// pipeline produces one ASS file per project, not per scene.
type CaptionsBuilt struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	SceneIdx  int    `json:"sceneIdx"`
	ASSPath   string `json:"assPath"`
}

func NewCaptionsBuilt(projectID, assPath string) CaptionsBuilt {
	return CaptionsBuilt{
		V: 1, Type: "CaptionsBuilt", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: 0, ASSPath: assPath,
	}
}

func (e CaptionsBuilt) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e CaptionsBuilt) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// RenderCompleted reports that the final video was rendered to OutputPath
// at a metered cost of RenderUsd. Project-scoped: there is exactly one
// render per project.
type RenderCompleted struct {
	V          int     `json:"v"`
	Type       string  `json:"type"`
	ProjectID  string  `json:"projectId"`
	At         string  `json:"at"`
	OutputPath string  `json:"outputPath"`
	RenderUsd  float64 `json:"renderUsd"`
}

func NewRenderCompleted(projectID, outputPath string, renderUsd float64) RenderCompleted {
	return RenderCompleted{
		V: 1, Type: "RenderCompleted", ProjectID: projectID, At: nowRFC3339(),
		OutputPath: outputPath, RenderUsd: renderUsd,
	}
}

func (e RenderCompleted) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e RenderCompleted) MsgID() string   { return projectMsgID(e.Type, e.ProjectID) }

// RunFailed reports that pipeline Stage failed for ProjectID with Error.
// SceneIdx (-1 for stages that aren't per-scene: caption, render) is used
// ONLY to compute MsgID — see plan decision #5. It is deliberately excluded
// from JSON (json:"-") because the frozen schema
// (spikes/event-model/events.ts) has no sceneIdx field on RunFailed.
type RunFailed struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	Stage     string `json:"stage"`
	Error     string `json:"error"`
	SceneIdx  int    `json:"-"`
}

func NewRunFailed(projectID, stage string, sceneIdx int, cause error) RunFailed {
	return RunFailed{
		V: 1, Type: "RunFailed", ProjectID: projectID, At: nowRFC3339(),
		Stage: stage, Error: cause.Error(), SceneIdx: sceneIdx,
	}
}

func (e RunFailed) Subject() string { return eventSubject(e.ProjectID, e.Type) }

// MsgID extends the frozen 3-part template with Stage — see plan decision
// #5: without it, two different stages failing for the same project (or
// same scene) within the dedup window would silently collapse into one
// stored event.
func (e RunFailed) MsgID() string {
	if e.SceneIdx < 0 {
		return fmt.Sprintf("%s-%s-%s-%s", e.Type, e.ProjectID, e.Stage, scenelessMarker)
	}
	return fmt.Sprintf("%s-%s-%s-%d", e.Type, e.ProjectID, e.Stage, e.SceneIdx)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run 'TestMaterialResolved|TestVoiceSynthesized|TestCaptionsBuilt|TestRenderCompleted|TestRunFailed' -v`
Expected: all `--- PASS` lines, then `PASS` / `ok`.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/eventstore/events.go worker/internal/eventstore/events_test.go
git commit -m "worker/eventstore: add typed MaterialResolved/VoiceSynthesized/CaptionsBuilt/RenderCompleted/RunFailed events"
```

---

## Task 4: `Store.PublishResult` — msgID-based idempotent publish (mirrors D4 spike)

**Files:**
- Modify: `worker/internal/eventstore/store.go`
- Test: `worker/internal/eventstore/store_test.go`

- [ ] **Step 1: Write the failing test**

Append to `worker/internal/eventstore/store_test.go`:

```go
func countEventsForSubject(t *testing.T, s *Store, subject string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, err := s.js.OrderedConsumer(ctx, StreamEvents, jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{subject},
	})
	if err != nil {
		t.Fatalf("ordered consumer for %s: %v", subject, err)
	}

	n := 0
	batch, err := c.Fetch(10, jetstream.FetchMaxWait(2*time.Second))
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	for range batch.Messages() {
		n++
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch error: %v", err)
	}
	return n
}

func TestPublishResult_DedupByMsgID(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer s.Close()

	projectID := "testp-" + uuid.NewString()[:8]
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	ev := NewRenderCompleted(projectID, "/data/media/"+projectID+"/out.mp4", 0)

	if _, err := s.PublishResult(ctx, ev); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if _, err := s.PublishResult(ctx, ev); err != nil {
		t.Fatalf("second publish: %v", err)
	}

	got := countEventsForSubject(t, s, ev.Subject())
	if got != 1 {
		t.Fatalf("want 1 stored event for %s (dedup by msgID %s), got %d", ev.Subject(), ev.MsgID(), got)
	}
}
```

Add imports to `store_test.go`:
```go
import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run TestPublishResult_DedupByMsgID -v`
Expected: FAIL — `s.PublishResult` undefined (build failure).

- [ ] **Step 3: Add PublishResult to store.go**

Append to `worker/internal/eventstore/store.go` (add `"context"` and `"encoding/json"` to the import block):

```go
// PublishResult marshals ev to JSON and publishes it to ev.Subject() with
// Nats-Msg-Id set to ev.MsgID(), so the VIDGEN_EVENTS stream's dupe window
// collapses repeated publishes of the same logical fact into one stored
// event. This is the correctness boundary that replaces the old
// output-file-exists check (index §4 / D4 checkpoint).
func (s *Store) PublishResult(ctx context.Context, ev Event) (*jetstream.PubAck, error) {
	data, err := json.Marshal(ev)
	if err != nil {
		return nil, fmt.Errorf("marshal event %s: %w", ev.Subject(), err)
	}

	ack, err := s.js.Publish(ctx, ev.Subject(), data, jetstream.WithMsgID(ev.MsgID()))
	if err != nil {
		return nil, fmt.Errorf("publish result %s: %w", ev.Subject(), err)
	}
	return ack, nil
}
```

- [ ] **Step 4: go mod tidy (pulls in google/uuid for the test) and run test to verify it passes**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
go mod tidy
go test ./internal/eventstore/... -run TestPublishResult_DedupByMsgID -v
```
Expected:
```
=== RUN   TestPublishResult_DedupByMsgID
--- PASS: TestPublishResult_DedupByMsgID (0.0Xs)
PASS
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/eventstore	0.0Xs
```

- [ ] **Step 5: Run the full eventstore package test suite so far**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -v`
Expected: every test from Tasks 2-4 passes (`TestConnect`, `TestConnect_BadURL`, `TestMaterialResolved`, `TestVoiceSynthesized`, `TestCaptionsBuilt`, `TestRenderCompleted`, `TestRunFailed`, `TestPublishResult_DedupByMsgID`), ends `ok`.

- [ ] **Step 6: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/go.mod worker/go.sum worker/internal/eventstore/store.go worker/internal/eventstore/store_test.go
git commit -m "worker/eventstore: add Store.PublishResult with msgID dedup, TDD'd against live NATS"
```

---

## Task 5: `eventstore.ConsumeJobs` — durable pull consumer, FetchMaxWait tuned low

**Files:**
- Create: `worker/internal/eventstore/jobs.go`
- Test: `worker/internal/eventstore/jobs_test.go`

- [ ] **Step 1: Write the failing test**

```go
// worker/internal/eventstore/jobs_test.go
package eventstore

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

type testJob struct {
	ProjectID string `json:"projectId"`
	SceneIdx  int    `json:"sceneIdx"`
}

func TestConsumeJobs_DecodesAndAcks(t *testing.T) {
	s, err := Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	defer s.Close()

	projectID := "testp-" + uuid.NewString()[:8]
	durable := "test-material-" + uuid.NewString()[:8]

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	stream, err := s.js.Stream(ctx, StreamJobs)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	t.Cleanup(func() {
		_ = s.js.DeleteConsumer(context.Background(), StreamJobs, durable)
	})

	subject := fmt.Sprintf("%s.%s.%s.2", jobSubjectPrefix, KindMaterial, projectID)
	want := testJob{ProjectID: projectID, SceneIdx: 2}
	data, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal job: %v", err)
	}
	if _, err := s.js.Publish(ctx, subject, data); err != nil {
		t.Fatalf("publish job: %v", err)
	}

	consumeCtx, stopConsume := context.WithCancel(context.Background())
	got := make(chan testJob, 1)
	errCh := make(chan error, 1)
	go func() {
		errCh <- ConsumeJobs(consumeCtx, s, KindMaterial, durable, func(ctx context.Context, subject string, job testJob) error {
			got <- job
			return nil
		})
	}()

	select {
	case job := <-got:
		if job != want {
			t.Fatalf("got job %+v, want %+v", job, want)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("timed out waiting for job to be consumed")
	}

	stopConsume()
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("ConsumeJobs returned error after cancel: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ConsumeJobs did not return within 5s of context cancellation")
	}

	_ = stream // keep referenced: consumer is created lazily inside ConsumeJobs itself
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run TestConsumeJobs_DecodesAndAcks -v`
Expected: FAIL — `ConsumeJobs` undefined (build failure).

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/eventstore/jobs.go
package eventstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

const (
	fetchBatchSize = 10
	// fetchMaxWait is tuned low per the D4 checkpoint finding: Fetch(n)
	// against fewer than n available messages otherwise blocks for the
	// default ~30s max-wait. A low value also bounds how long ConsumeJobs
	// takes to notice ctx cancellation and return (worst case: one more
	// in-flight Fetch call), so it doubles as the shutdown-latency budget.
	fetchMaxWait = 2 * time.Second
)

// JobHandler processes one decoded job message of type T. Returning an
// error leaves the message un-acked so JetStream redelivers it — reserved
// for infra failures (e.g. can't publish the result event); domain-level
// failures should be captured as a RunFailed event and the handler should
// then return nil (see plan decision #9 in the P3 plan doc).
type JobHandler[T any] func(ctx context.Context, subject string, job T) error

// ConsumeJobs attaches a durable pull consumer named durable, filtered to
// vidgen.job.<kind>.>, and decodes each fetched message into T before
// invoking handler. It loops fetching small batches with a low
// FetchMaxWait until ctx is cancelled, then returns nil. It does not create
// the VIDGEN_JOBS stream (owned by api/P1) — the stream must already exist.
func ConsumeJobs[T any](ctx context.Context, s *Store, kind JobKind, durable string, handler JobHandler[T]) error {
	stream, err := s.js.Stream(ctx, StreamJobs)
	if err != nil {
		return fmt.Errorf("open stream %s: %w", StreamJobs, err)
	}

	filter := fmt.Sprintf("%s.%s.>", jobSubjectPrefix, kind)
	cons, err := stream.CreateOrUpdateConsumer(ctx, jetstream.ConsumerConfig{
		Durable:        durable,
		FilterSubjects: []string{filter},
		AckPolicy:      jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return fmt.Errorf("create consumer %s on %s: %w", durable, StreamJobs, err)
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		batch, err := cons.Fetch(fetchBatchSize, jetstream.FetchMaxWait(fetchMaxWait))
		if err != nil {
			return fmt.Errorf("fetch batch for consumer %s: %w", durable, err)
		}

		for msg := range batch.Messages() {
			var job T
			if err := json.Unmarshal(msg.Data(), &job); err != nil {
				// malformed payload cannot succeed on redelivery: drop it
				_ = msg.Term()
				continue
			}
			if err := handler(ctx, msg.Subject(), job); err != nil {
				_ = msg.Nak()
				continue
			}
			_ = msg.Ack()
		}
		if err := batch.Error(); err != nil {
			return fmt.Errorf("fetch batch error for consumer %s: %w", durable, err)
		}
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -run TestConsumeJobs_DecodesAndAcks -v`
Expected:
```
=== RUN   TestConsumeJobs_DecodesAndAcks
--- PASS: TestConsumeJobs_DecodesAndAcks (0.0Xs)
PASS
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/eventstore	0.0Xs
```

- [ ] **Step 5: Run the entire eventstore suite (final check for this package)**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/eventstore/... -v`
Expected: all tests from Tasks 2-5 pass, ends `ok`.

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go vet ./internal/eventstore/...`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/eventstore/jobs.go worker/internal/eventstore/jobs_test.go
git commit -m "worker/eventstore: add ConsumeJobs durable pull consumer, TDD'd against live NATS"
```

---

## Task 6: `jobhandler` package scaffold — job payload types + shared failure helper

**Files:**
- Create: `worker/internal/jobhandler/types.go`
- Create: `worker/internal/jobhandler/failure.go`

- [ ] **Step 1: Define the job payload types**

```go
// worker/internal/jobhandler/types.go
package jobhandler

import "github.com/cuongtranba/video-generation-skill/worker/internal/domain"

// Job payload JSON contract — see plan decision #7 in the P3 plan doc: this
// plan defines these shapes since P1 (which produces them) is not yet
// authored. camelCase throughout to match the rest of the webapp's JSON
// convention (the frozen event catalogue is camelCase).

// MaterialJob resolves scene SceneIdx's stock/local media into DestPath.
type MaterialJob struct {
	ProjectID      string `json:"projectId"`
	SceneIdx       int    `json:"sceneIdx"`
	Query          string `json:"query"`
	LocalAssetPath string `json:"localAssetPath,omitempty"`
	DestPath       string `json:"destPath"`
}

// TTSJob synthesizes scene SceneIdx's narration into DestPath.
type TTSJob struct {
	ProjectID string       `json:"projectId"`
	SceneIdx  int          `json:"sceneIdx"`
	Text      string       `json:"text"`
	Voice     domain.Voice `json:"voice"`
	Speed     domain.Speed `json:"speed"`
	DestPath  string       `json:"destPath"`
}

// SceneAudioRef locates one scene's voiceover inside the final timeline,
// for caption transcription offset alignment.
type SceneAudioRef struct {
	AudioPath      string  `json:"audioPath"`
	StartOffsetSec float64 `json:"startOffsetSec"`
}

// CaptionJob transcribes every scene's audio and writes one ASS file for
// the whole project to DestPath. NOTE: Style embeds domain.CaptionStyle,
// which (unmodified, kept package) has snake_case JSON tags — see plan
// decision #7's documented inconsistency.
type CaptionJob struct {
	ProjectID  string              `json:"projectId"`
	SceneAudio []SceneAudioRef     `json:"sceneAudio"`
	Style      domain.CaptionStyle `json:"style"`
	DestPath   string              `json:"destPath"`
}

// RenderSceneJob is one scene's contribution to the final render.
type RenderSceneJob struct {
	MediaPath        string  `json:"mediaPath"`
	AudioPath        string  `json:"audioPath"`
	IsImage          bool    `json:"isImage"`
	DurationSec      float64 `json:"durationSec"`
	MediaDurationSec float64 `json:"mediaDurationSec"`
}

// RenderMusicJob is the optional background music track.
type RenderMusicJob struct {
	Path        string  `json:"path"`
	DurationSec float64 `json:"durationSec"`
	Volume      float64 `json:"volume"`
}

// RenderJob renders the final video to OutputPath.
type RenderJob struct {
	ProjectID  string           `json:"projectId"`
	Scenes     []RenderSceneJob `json:"scenes"`
	ASSPath    string           `json:"assPath"`
	Music      *RenderMusicJob  `json:"music,omitempty"`
	OutputPath string           `json:"outputPath"`
}
```

- [ ] **Step 2: Define the shared RunFailed-publishing helper**

```go
// worker/internal/jobhandler/failure.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// publishFailure appends a RunFailed event for a job that failed at stage,
// for the given project (and, for scene-scoped stages, scene). Per plan
// decision #9, a domain-level failure is a valid terminal state: the caller
// should return nil after this succeeds (ack, no redelivery). Only a
// failure to publish the RunFailed event itself should propagate as an
// error (nothing was durably recorded, so a retry is safe and necessary).
func publishFailure(ctx context.Context, store *eventstore.Store, projectID, stage string, sceneIdx int, cause error) error {
	ev := eventstore.NewRunFailed(projectID, stage, sceneIdx, cause)
	if _, err := store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish RunFailed(stage=%s, project=%s): %w", stage, projectID, err)
	}
	return nil
}
```

- [ ] **Step 3: Build to verify it compiles (no tests yet — pure data types + one helper, exercised by Tasks 7-10)**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go build ./internal/jobhandler/...`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/jobhandler/types.go worker/internal/jobhandler/failure.go
git commit -m "worker/jobhandler: add job payload types and shared RunFailed helper"
```

---

## Task 7: `MaterialHandler` — job → `material.MaterialSource` → `MaterialResolved`/`RunFailed`

**Files:**
- Create: `worker/internal/jobhandler/material.go`
- Test: `worker/internal/jobhandler/material_test.go`

This replaces `internal/worker.MaterialWorker.handle` (`internal/worker/worker.go:100-148`): same domain logic (user-provided local asset used in place; else search + download the first result), re-pointed to publish an `eventstore.Event` instead of returning a `MaterialResult` over the embedded bus. The `os.Stat(job.DestPath)` pre-check is kept as a cheap short-circuit (skip re-downloading) but `PublishResult` always runs afterward — msgID dedup, not the file check, is now the correctness boundary (plan decision in the P3 spec item 2).

- [ ] **Step 1: Write the failing tests**

```go
// worker/internal/jobhandler/material_test.go
package jobhandler

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
)

type stubMaterialSource struct {
	assets    []material.Asset
	searchErr error
	downloads []material.Asset
}

func (s *stubMaterialSource) Search(ctx context.Context, req material.SearchRequest) ([]material.Asset, error) {
	if s.searchErr != nil {
		return nil, s.searchErr
	}
	return s.assets, nil
}

func (s *stubMaterialSource) Download(ctx context.Context, asset material.Asset, destPath string) error {
	s.downloads = append(s.downloads, asset)
	return os.WriteFile(destPath, []byte("stub-media"), 0o644)
}

func (s *stubMaterialSource) Name() string { return "stub" }

func TestMaterialHandler_DownloadsAndPublishesMaterialResolved(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "scene-0.mp4")
	source := &stubMaterialSource{assets: []material.Asset{
		{ID: "a1", Type: material.AssetVideo, Source: "stub", DurationSec: 5},
	}}
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	job := MaterialJob{ProjectID: "proj1", SceneIdx: 0, Query: "sunset", DestPath: destPath}
	if err := h.Handle(context.Background(), "vidgen.job.material.proj1.0", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if _, err := os.Stat(destPath); err != nil {
		t.Fatalf("expected downloaded file at %s: %v", destPath, err)
	}
	if len(source.downloads) != 1 {
		t.Fatalf("want 1 download call, got %d", len(source.downloads))
	}

	got := awaitEvent[eventstore.MaterialResolved](t, store, "vidgen.evt.proj1.MaterialResolved")
	if got.SceneIdx != 0 || got.AssetPath != destPath || got.Source != "stub" {
		t.Fatalf("unexpected MaterialResolved: %+v", got)
	}
}

func TestMaterialHandler_LocalAssetSkipsDownload(t *testing.T) {
	dir := t.TempDir()
	localPath := filepath.Join(dir, "user-photo.jpg")
	if err := os.WriteFile(localPath, []byte("jpg"), 0o644); err != nil {
		t.Fatalf("seed local asset: %v", err)
	}
	source := &stubMaterialSource{}
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	job := MaterialJob{ProjectID: "proj2", SceneIdx: 1, LocalAssetPath: localPath, DestPath: filepath.Join(dir, "unused.mp4")}
	if err := h.Handle(context.Background(), "vidgen.job.material.proj2.1", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(source.downloads) != 0 {
		t.Fatalf("local asset must not trigger a download, got %d calls", len(source.downloads))
	}

	got := awaitEvent[eventstore.MaterialResolved](t, store, "vidgen.evt.proj2.MaterialResolved")
	if got.AssetPath != localPath || got.Source != "local" {
		t.Fatalf("unexpected MaterialResolved: %+v", got)
	}
}

func TestMaterialHandler_NoResultsPublishesRunFailed(t *testing.T) {
	source := &stubMaterialSource{} // empty Search result
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	job := MaterialJob{ProjectID: "proj3", SceneIdx: 4, Query: "nonexistent", DestPath: t.TempDir() + "/scene-4.mp4"}
	if err := h.Handle(context.Background(), "vidgen.job.material.proj3.4", job); err != nil {
		t.Fatalf("Handle should ack (return nil) after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt.proj3.RunFailed")
	if got.Stage != "material" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
```

- [ ] **Step 2: Add the shared test helpers `newTestStore` / `awaitEvent` (used by every jobhandler test in Tasks 7-10)**

```go
// worker/internal/jobhandler/helpers_test.go
package jobhandler

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// newTestStore connects to the dev NATS instance used throughout this
// plan's tests (nats://localhost:4223 — see index doc §8; the VIDGEN_EVENTS
// / VIDGEN_JOBS streams already exist there, confirmed while writing this
// plan). Each test uses uuid-suffixed project IDs so runs never collide.
func newTestStore(t *testing.T) *eventstore.Store {
	t.Helper()
	s, err := eventstore.Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// awaitEvent fetches the single most recent stored event for subject and
// decodes it into T. Used to assert on what a handler published without
// needing a second long-running consumer.
func awaitEvent[T any](t *testing.T, store interface {
	Connect() // never called; placeholder to keep signature simple below
}, subject string) T {
	panic("replaced below")
}
```

Actually — write it directly against `*eventstore.Store` (no interface needed); replace the stub above with:

```go
// worker/internal/jobhandler/helpers_test.go
package jobhandler

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// newTestStore connects to the dev NATS instance used throughout this
// plan's tests (nats://localhost:4223 — see index doc §8; the VIDGEN_EVENTS
// / VIDGEN_JOBS streams already exist there, confirmed while writing this
// plan). Each test uses uuid-suffixed project IDs so runs never collide.
func newTestStore(t *testing.T) *eventstore.Store {
	t.Helper()
	s, err := eventstore.Connect("nats://localhost:4223")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// awaitEvent fetches the single most recently stored event for subject and
// decodes it into T. Used to assert on what a handler published.
func awaitEvent[T any](t *testing.T, store *eventstore.Store, subject string) T {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c, err := store.RawJetStream().OrderedConsumer(ctx, eventstore.StreamEvents, jetstream.OrderedConsumerConfig{
		FilterSubjects: []string{subject},
	})
	if err != nil {
		t.Fatalf("ordered consumer for %s: %v", subject, err)
	}

	batch, err := c.Fetch(1, jetstream.FetchMaxWait(3*time.Second))
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}

	var out T
	found := false
	for msg := range batch.Messages() {
		if err := json.Unmarshal(msg.Data(), &out); err != nil {
			t.Fatalf("unmarshal %s: %v", subject, err)
		}
		found = true
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("fetch batch error: %v", err)
	}
	if !found {
		t.Fatalf("no stored event found for subject %s", subject)
	}
	return out
}
```

This requires exposing the underlying `jetstream.JetStream` from `Store` for tests. Add to `worker/internal/eventstore/store.go`:

```go
// RawJetStream exposes the underlying JetStream context for callers (test
// helpers, ordered-consumer replay tooling) that need direct access beyond
// PublishResult/ConsumeJobs. Not for use in job-handling hot paths.
func (s *Store) RawJetStream() jetstream.JetStream {
	return s.js
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestMaterialHandler -v`
Expected: FAIL — `NewMaterialHandler` undefined (build failure).

- [ ] **Step 4: Write the implementation**

```go
// worker/internal/jobhandler/material.go
package jobhandler

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
)

// MaterialHandler consumes material jobs, resolves scene media via source
// (or in place if the job carries a user-provided local asset), and
// publishes MaterialResolved (or RunFailed on error) to store.
type MaterialHandler struct {
	source material.MaterialSource
	probe  material.DurationProbe
	store  *eventstore.Store
}

func NewMaterialHandler(source material.MaterialSource, probe material.DurationProbe, store *eventstore.Store) *MaterialHandler {
	return &MaterialHandler{source: source, probe: probe, store: store}
}

func isImagePath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	}
	return false
}

func (h *MaterialHandler) Handle(ctx context.Context, subject string, job MaterialJob) error {
	assetPath, source, err := h.resolve(ctx, job)
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "material", job.SceneIdx, err)
	}

	ev := eventstore.NewMaterialResolved(job.ProjectID, job.SceneIdx, source, assetPath)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish MaterialResolved for project %s scene %d: %w", job.ProjectID, job.SceneIdx, err)
	}
	return nil
}

// resolve returns the resolved media's path and the source that provided it
// ("local" for a user-provided asset, otherwise the MaterialSource's Name()
// — e.g. "pexels").
func (h *MaterialHandler) resolve(ctx context.Context, job MaterialJob) (assetPath, source string, err error) {
	if job.LocalAssetPath != "" {
		return job.LocalAssetPath, "local", nil
	}

	// cheap short-circuit: msgID dedup at publish time is the correctness
	// boundary, this just avoids redundant downloads on redelivery.
	if _, err := os.Stat(job.DestPath); err == nil {
		return job.DestPath, "cached", nil
	}

	assets, err := h.source.Search(ctx, material.SearchRequest{
		Query:       job.Query,
		Orientation: "portrait",
		Count:       3,
	})
	if err != nil {
		return "", "", fmt.Errorf("search material for %q: %w", job.Query, err)
	}
	if len(assets) == 0 {
		return "", "", fmt.Errorf("no material found for query %q", job.Query)
	}

	asset := assets[0]
	if err := h.source.Download(ctx, asset, job.DestPath); err != nil {
		return "", "", fmt.Errorf("download material for %q: %w", job.Query, err)
	}
	return job.DestPath, asset.Source, nil
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
go test ./internal/jobhandler/... -run TestMaterialHandler -v
```
Expected:
```
=== RUN   TestMaterialHandler_DownloadsAndPublishesMaterialResolved
--- PASS: TestMaterialHandler_DownloadsAndPublishesMaterialResolved (0.0Xs)
=== RUN   TestMaterialHandler_LocalAssetSkipsDownload
--- PASS: TestMaterialHandler_LocalAssetSkipsDownload (0.0Xs)
=== RUN   TestMaterialHandler_NoResultsPublishesRunFailed
--- PASS: TestMaterialHandler_NoResultsPublishesRunFailed (0.0Xs)
PASS
ok  	github.com/cuongtranba/video-generation-skill/worker/internal/jobhandler	0.0Xs
```

- [ ] **Step 6: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/eventstore/store.go worker/internal/jobhandler/material.go worker/internal/jobhandler/material_test.go worker/internal/jobhandler/helpers_test.go
git commit -m "worker/jobhandler: add MaterialHandler wiring material.MaterialSource to MaterialResolved/RunFailed"
```

---

## Task 8: `TTSHandler` — job → `tts.TTSProvider` → `VoiceSynthesized`/`RunFailed`

**Files:**
- Create: `worker/internal/jobhandler/tts.go`
- Test: `worker/internal/jobhandler/tts_test.go`

Mirrors `internal/worker.TTSWorker.handle` (`internal/worker/worker.go:43-71`). `ttsUsd` is computed from `SynthesizeResult.CharsCharged` using the same per-character rate as root's `internal/cost.FPTAIPerChar` (that package is api-owned, not copied here — plan decision: the rate constant is duplicated locally since the worker must report a cost per event but does not own cost-cap enforcement).

- [ ] **Step 1: Write the failing tests**

```go
// worker/internal/jobhandler/tts_test.go
package jobhandler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

type stubTTSProvider struct {
	result tts.SynthesizeResult
	err    error
}

func (s *stubTTSProvider) Synthesize(ctx context.Context, req tts.SynthesizeRequest, destPath string) (tts.SynthesizeResult, error) {
	if s.err != nil {
		return tts.SynthesizeResult{}, s.err
	}
	if err := os.WriteFile(destPath, []byte("mp3"), 0o644); err != nil {
		return tts.SynthesizeResult{}, err
	}
	return s.result, nil
}

func TestTTSHandler_SynthesizesAndPublishesVoiceSynthesized(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "scene-0.mp3")
	provider := &stubTTSProvider{result: tts.SynthesizeResult{AudioPath: destPath, DurationSec: 3.5, CharsCharged: 42}}
	store := newTestStore(t)
	h := NewTTSHandler(provider, store)

	job := TTSJob{ProjectID: "proj4", SceneIdx: 0, Text: "xin chao", Voice: domain.VoiceBanmai, Speed: 0, DestPath: destPath}
	if err := h.Handle(context.Background(), "vidgen.job.tts.proj4.0", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := awaitEvent[eventstore.VoiceSynthesized](t, store, "vidgen.evt.proj4.VoiceSynthesized")
	if got.SceneIdx != 0 || got.MP3Path != destPath {
		t.Fatalf("unexpected VoiceSynthesized: %+v", got)
	}
	if got.TTSUsd <= 0 {
		t.Fatalf("expected TTSUsd > 0 for 42 charged chars, got %v", got.TTSUsd)
	}
}

func TestTTSHandler_ProviderErrorPublishesRunFailed(t *testing.T) {
	provider := &stubTTSProvider{err: errors.New("FPT.AI rejected request")}
	store := newTestStore(t)
	h := NewTTSHandler(provider, store)

	job := TTSJob{ProjectID: "proj5", SceneIdx: 3, Text: "loi thoai", Voice: domain.VoiceBanmai, DestPath: t.TempDir() + "/scene-3.mp3"}
	if err := h.Handle(context.Background(), "vidgen.job.tts.proj5.3", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt.proj5.RunFailed")
	if got.Stage != "tts" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestTTSHandler -v`
Expected: FAIL — `NewTTSHandler` undefined.

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/jobhandler/tts.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

// fptAIPerChar mirrors root internal/cost.FPTAIPerChar (an api-owned
// package, not copied into worker): approximate FPT.AI TTS price per
// character in USD. Verify against the FPT console rate card before
// production use. The worker reports cost per event; it does not own
// cost-cap enforcement (that is api's job, per index §6).
const fptAIPerChar = 0.000010

// TTSHandler consumes TTS jobs, synthesizes scene narration via provider,
// and publishes VoiceSynthesized (or RunFailed on error) to store.
type TTSHandler struct {
	provider tts.TTSProvider
	store    *eventstore.Store
}

func NewTTSHandler(provider tts.TTSProvider, store *eventstore.Store) *TTSHandler {
	return &TTSHandler{provider: provider, store: store}
}

func (h *TTSHandler) Handle(ctx context.Context, subject string, job TTSJob) error {
	out, err := h.provider.Synthesize(ctx, tts.SynthesizeRequest{
		Text:  job.Text,
		Voice: job.Voice,
		Speed: job.Speed,
	}, job.DestPath)
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "tts", job.SceneIdx, err)
	}

	ttsUsd := float64(out.CharsCharged) * fptAIPerChar
	ev := eventstore.NewVoiceSynthesized(job.ProjectID, job.SceneIdx, out.AudioPath, ttsUsd)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish VoiceSynthesized for project %s scene %d: %w", job.ProjectID, job.SceneIdx, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestTTSHandler -v`
Expected: both tests `--- PASS`, ends `ok`.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/jobhandler/tts.go worker/internal/jobhandler/tts_test.go
git commit -m "worker/jobhandler: add TTSHandler wiring tts.TTSProvider to VoiceSynthesized/RunFailed"
```

---

## Task 9: `CaptionHandler` — job → whisper transcribe + ASS write → `CaptionsBuilt`/`RunFailed`

**Files:**
- Create: `worker/internal/jobhandler/caption.go`
- Test: `worker/internal/jobhandler/caption_test.go`

Mirrors `internal/worker.CaptionWorker.handle` (`internal/worker/worker.go:169-199`): transcribes every `SceneAudio` entry, offsets word timestamps by `StartOffsetSec`, concatenates, writes one ASS file. `Transcriber` is the same narrow interface `internal/worker` defines (`Transcribe(ctx, audioPath) ([]caption.WordTimestamp, error)`), re-declared here since `internal/worker` itself is not a kept package.

- [ ] **Step 1: Write the failing tests**

```go
// worker/internal/jobhandler/caption_test.go
package jobhandler

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

type stubTranscriber struct {
	words map[string][]caption.WordTimestamp
	err   error
}

func (s *stubTranscriber) Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.words[audioPath], nil
}

func TestCaptionHandler_WritesASSAndPublishesCaptionsBuilt(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "captions.ass")
	transcriber := &stubTranscriber{words: map[string][]caption.WordTimestamp{
		"scene0.mp3": {{Word: "xin", Start: 0, End: 0.3}, {Word: "chao", Start: 0.3, End: 0.6}},
	}}
	store := newTestStore(t)
	h := NewCaptionHandler(transcriber, caption.NewASSWriter(), store)

	job := CaptionJob{
		ProjectID:  "proj6",
		SceneAudio: []SceneAudioRef{{AudioPath: "scene0.mp3", StartOffsetSec: 0}},
		Style:      domain.CaptionStyle{},
		DestPath:   destPath,
	}
	if err := h.Handle(context.Background(), "vidgen.job.caption.proj6.-", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := awaitEvent[eventstore.CaptionsBuilt](t, store, "vidgen.evt.proj6.CaptionsBuilt")
	if got.ASSPath != destPath || got.SceneIdx != 0 {
		t.Fatalf("unexpected CaptionsBuilt: %+v", got)
	}
}

func TestCaptionHandler_TranscribeErrorPublishesRunFailed(t *testing.T) {
	transcriber := &stubTranscriber{err: errors.New("whisper crashed")}
	store := newTestStore(t)
	h := NewCaptionHandler(transcriber, caption.NewASSWriter(), store)

	job := CaptionJob{
		ProjectID:  "proj7",
		SceneAudio: []SceneAudioRef{{AudioPath: "scene0.mp3"}},
		DestPath:   t.TempDir() + "/captions.ass",
	}
	if err := h.Handle(context.Background(), "vidgen.job.caption.proj7.-", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt.proj7.RunFailed")
	if got.Stage != "caption" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestCaptionHandler -v`
Expected: FAIL — `NewCaptionHandler` undefined.

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/jobhandler/caption.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// Transcriber yields word-level timestamps for an audio file. Narrow
// interface re-declared here (mirrors internal/worker.Transcriber) since
// internal/worker is not a kept package.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error)
}

var _ Transcriber = (*caption.WhisperRunner)(nil)

// CaptionHandler consumes caption jobs, transcribes every scene's audio,
// writes one merged ASS file for the project, and publishes CaptionsBuilt
// (or RunFailed on error) to store.
type CaptionHandler struct {
	transcriber Transcriber
	writer      *caption.ASSWriter
	store       *eventstore.Store
}

func NewCaptionHandler(transcriber Transcriber, writer *caption.ASSWriter, store *eventstore.Store) *CaptionHandler {
	return &CaptionHandler{transcriber: transcriber, writer: writer, store: store}
}

func (h *CaptionHandler) Handle(ctx context.Context, subject string, job CaptionJob) error {
	var allWords []caption.WordTimestamp
	for _, ref := range job.SceneAudio {
		words, err := h.transcriber.Transcribe(ctx, ref.AudioPath)
		if err != nil {
			return publishFailure(ctx, h.store, job.ProjectID, "caption", -1, fmt.Errorf("transcribe %s: %w", ref.AudioPath, err))
		}
		for _, w := range words {
			allWords = append(allWords, caption.WordTimestamp{
				Word:  w.Word,
				Start: w.Start + ref.StartOffsetSec,
				End:   w.End + ref.StartOffsetSec,
			})
		}
	}

	if err := h.writer.Write(allWords, job.Style, job.DestPath); err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "caption", -1, fmt.Errorf("write ASS: %w", err))
	}

	ev := eventstore.NewCaptionsBuilt(job.ProjectID, job.DestPath)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish CaptionsBuilt for project %s: %w", job.ProjectID, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestCaptionHandler -v`
Expected: both tests `--- PASS`, ends `ok`.

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/jobhandler/caption.go worker/internal/jobhandler/caption_test.go
git commit -m "worker/jobhandler: add CaptionHandler wiring transcriber+ASSWriter to CaptionsBuilt/RunFailed"
```

---

## Task 10: `RenderHandler` — job → `render.Renderer` → `RenderCompleted`/`RunFailed`

**Files:**
- Create: `worker/internal/jobhandler/render.go`
- Test: `worker/internal/jobhandler/render_test.go`

Mirrors `internal/worker.RenderWorker.handle` (`internal/worker/worker.go:219-241`). `render.RenderUsd` is always `0` (ffmpeg is local/free — matches index §6: "render ($0)").

- [ ] **Step 1: Write the failing tests**

```go
// worker/internal/jobhandler/render_test.go
package jobhandler

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

type stubRenderer struct {
	result render.RenderResult
	err    error
	got    render.RenderRequest
}

func (s *stubRenderer) Render(ctx context.Context, req render.RenderRequest) (render.RenderResult, error) {
	s.got = req
	if s.err != nil {
		return render.RenderResult{}, s.err
	}
	return s.result, nil
}

func TestRenderHandler_RendersAndPublishesRenderCompleted(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "out.mp4")
	renderer := &stubRenderer{result: render.RenderResult{OutputPath: outputPath, DurationSec: 12.0, FileSizeBytes: 1024}}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, store)

	job := RenderJob{
		ProjectID: "proj8",
		Scenes:    []RenderSceneJob{{MediaPath: "scene0.mp4", AudioPath: "scene0.mp3", DurationSec: 5}},
		ASSPath:   "captions.ass",
		Music:     &RenderMusicJob{Path: "track.mp3", DurationSec: 30, Volume: 0.15},
		OutputPath: outputPath,
	}
	if err := h.Handle(context.Background(), "vidgen.job.render.proj8.-", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(renderer.got.Scenes) != 1 || renderer.got.Scenes[0].MediaPath != "scene0.mp4" {
		t.Fatalf("Renderer.Render called with unexpected scenes: %+v", renderer.got.Scenes)
	}
	if renderer.got.Music == nil || renderer.got.Music.Path != "track.mp3" {
		t.Fatalf("Renderer.Render called with unexpected music: %+v", renderer.got.Music)
	}

	got := awaitEvent[eventstore.RenderCompleted](t, store, "vidgen.evt.proj8.RenderCompleted")
	if got.OutputPath != outputPath || got.RenderUsd != 0 {
		t.Fatalf("unexpected RenderCompleted: %+v", got)
	}
}

func TestRenderHandler_RenderErrorPublishesRunFailed(t *testing.T) {
	renderer := &stubRenderer{err: errors.New("ffmpeg exit 1")}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, store)

	job := RenderJob{ProjectID: "proj9", Scenes: []RenderSceneJob{{MediaPath: "scene0.mp4"}}, OutputPath: t.TempDir() + "/out.mp4"}
	if err := h.Handle(context.Background(), "vidgen.job.render.proj9.-", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt.proj9.RunFailed")
	if got.Stage != "render" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestRenderHandler -v`
Expected: FAIL — `NewRenderHandler` undefined.

- [ ] **Step 3: Write the implementation**

```go
// worker/internal/jobhandler/render.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

// RenderHandler consumes render jobs, invokes the kept ffmpeg renderer, and
// publishes RenderCompleted (or RunFailed on error) to store.
type RenderHandler struct {
	renderer render.Renderer
	store    *eventstore.Store
}

func NewRenderHandler(renderer render.Renderer, store *eventstore.Store) *RenderHandler {
	return &RenderHandler{renderer: renderer, store: store}
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

func toMusicInput(m *RenderMusicJob) *render.MusicInput {
	if m == nil {
		return nil
	}
	return &render.MusicInput{Path: m.Path, DurationSec: m.DurationSec, Volume: m.Volume}
}

func (h *RenderHandler) Handle(ctx context.Context, subject string, job RenderJob) error {
	out, err := h.renderer.Render(ctx, render.RenderRequest{
		Scenes:     toSceneInputs(job.Scenes),
		ASSPath:    job.ASSPath,
		Music:      toMusicInput(job.Music),
		OutputPath: job.OutputPath,
	})
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "render", -1, err)
	}

	// render is local/free — index §6: "Enforced per-video cost = Σ
	// VoiceSynthesized.ttsUsd ... + render ($0)".
	ev := eventstore.NewRenderCompleted(job.ProjectID, out.OutputPath, 0)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish RenderCompleted for project %s: %w", job.ProjectID, err)
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go test ./internal/jobhandler/... -run TestRenderHandler -v`
Expected: both tests `--- PASS`, ends `ok`.

- [ ] **Step 5: Run the entire jobhandler suite, then vet the whole module**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
go test ./internal/jobhandler/... -v
go vet ./...
```
Expected: every jobhandler test `--- PASS`, ends `ok`; `go vet ./...` produces no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/internal/jobhandler/render.go worker/internal/jobhandler/render_test.go
git commit -m "worker/jobhandler: add RenderHandler wiring render.Renderer to RenderCompleted/RunFailed"
```

---

## Task 11: `cmd/worker/main.go` — bootstrap, wire 4 handlers, graceful shutdown

**Files:**
- Create: `worker/cmd/worker/main.go`

No TDD here (an `os.Exit`-driving `main` is conventionally not unit-tested; correctness is covered by the `internal/eventstore` and `internal/jobhandler` tests above plus the manual verification steps below).

- [ ] **Step 1: Write main.go**

```go
// worker/cmd/worker/main.go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/jobhandler"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
	"github.com/cuongtranba/video-generation-skill/worker/internal/prereq"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("worker: %v", err)
	}
}

func run() error {
	natsURL := envOrDefault("NATS_URL", "nats://nats:4222")
	envPath := envOrDefault("VIDGEN_ENV_PATH", "/app/.env")
	configPath := envOrDefault("VIDGEN_CONFIG_PATH", "/app/config.yaml")

	checker := prereq.NewChecker()
	if err := checker.Check(); err != nil {
		return fmt.Errorf("check prerequisites: %w", err)
	}
	ffmpegBin, err := checker.Resolve("ffmpeg")
	if err != nil {
		return fmt.Errorf("resolve ffmpeg: %w", err)
	}
	ffprobeBin, err := checker.Resolve("ffprobe")
	if err != nil {
		return fmt.Errorf("resolve ffprobe: %w", err)
	}
	whisperBin, err := checker.Resolve("whisper")
	if err != nil {
		return fmt.Errorf("resolve whisper: %w", err)
	}

	cfg, err := config.Load(envPath)
	if err != nil {
		return fmt.Errorf("load env config %s: %w", envPath, err)
	}
	providers, err := config.LoadProviders(configPath)
	if err != nil {
		return fmt.Errorf("load providers config %s: %w", configPath, err)
	}
	if err := cfg.ValidateForProviders(providers); err != nil {
		return fmt.Errorf("validate provider config: %w", err)
	}

	probe := tts.FFProbeDuration(ffprobeBin)

	ttsProvider, err := tts.NewFromConfig(providers.TTS, cfg.FPTTTSAPIKey)
	if err != nil {
		return fmt.Errorf("build tts provider: %w", err)
	}
	materialSource, err := material.NewFromConfig(providers.Material, cfg)
	if err != nil {
		return fmt.Errorf("build material source: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := eventstore.Connect(natsURL)
	if err != nil {
		return fmt.Errorf("connect eventstore at %s: %w", natsURL, err)
	}
	defer store.Close()

	materialHandler := jobhandler.NewMaterialHandler(materialSource, material.DurationProbe(probe), store)
	ttsHandler := jobhandler.NewTTSHandler(ttsProvider, store)
	captionHandler := jobhandler.NewCaptionHandler(caption.NewWhisperRunner(whisperBin), caption.NewASSWriter(), store)
	renderHandler := jobhandler.NewRenderHandler(render.NewFFmpegRenderer(ffmpegBin, ffprobeBin), store)

	type consumer struct {
		kind    eventstore.JobKind
		durable string
		run     func() error
	}
	consumers := []consumer{
		{eventstore.KindMaterial, "worker-material", nil},
		{eventstore.KindTTS, "worker-tts", nil},
		{eventstore.KindCaption, "worker-caption", nil},
		{eventstore.KindRender, "worker-render", nil},
	}
	consumers[0].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindMaterial, "worker-material", materialHandler.Handle)
	}
	consumers[1].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindTTS, "worker-tts", ttsHandler.Handle)
	}
	consumers[2].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindCaption, "worker-caption", captionHandler.Handle)
	}
	consumers[3].run = func() error {
		return eventstore.ConsumeJobs(ctx, store, eventstore.KindRender, "worker-render", renderHandler.Handle)
	}

	errCh := make(chan error, len(consumers))
	for _, c := range consumers {
		c := c
		go func() {
			log.Printf("worker: consuming %s jobs (durable=%s)", c.kind, c.durable)
			errCh <- c.run()
		}()
	}

	var errs []error
	for range consumers {
		if err := <-errCh; err != nil {
			errs = append(errs, err)
		}
	}
	log.Print("worker: all consumers stopped, shutting down")
	return errors.Join(errs...)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

- [ ] **Step 2: Build it**

Run: `cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker && go build -o /tmp/vidgen-worker ./cmd/worker`
Expected: exits 0, produces `/tmp/vidgen-worker`.

- [ ] **Step 3: Manual smoke test against the live dev NATS**

Run (requires `ffmpeg`, `ffprobe`, `whisper` resolvable on `PATH`, or set `FFMPEG_BIN`/`FFPROBE_BIN`/`WHISPER_BIN`; requires a `.env` with at least `FPT_TTS_API_KEY` and `PEXELS_API_KEY` for `ValidateForProviders` to pass — or a `config.yaml` that deselects those providers):

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
NATS_URL=nats://localhost:4223 VIDGEN_ENV_PATH=../.env VIDGEN_CONFIG_PATH=../config.yaml /tmp/vidgen-worker &
sleep 2
kill -TERM %1
wait
```
Expected: 4 log lines `worker: consuming <kind> jobs (durable=worker-<kind>)` (order may vary across goroutines), then after `SIGTERM`, within ~2s (bounded by `fetchMaxWait`) `worker: all consumers stopped, shutting down` and the process exits 0. If prerequisite/config errors occur (missing `ffmpeg`/`.env` keys), that is expected in an environment without those installed — the check is that `run()` returns a clear `fmt.Errorf`-wrapped message identifying which prerequisite/config is missing, not a panic or opaque failure.

- [ ] **Step 4: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/cmd/worker/main.go
git commit -m "worker: add cmd/worker main.go bootstrapping eventstore + 4 job handlers with graceful shutdown"
```

---

## Task 12: `worker/Dockerfile`

**Files:**
- Create: `worker/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Two-stage build: `golang:1.25-bookworm` compiles the binary; `python:3.11-slim-bookworm` (needed for `pip install openai-whisper`) provides the runtime, with `ffmpeg` installed via `apt-get` — Debian's `ffmpeg` package (unlike the Homebrew **core** formula called out in the root `CLAUDE.md` gotcha) is built with libass/subtitle support, but the Dockerfile still runs an explicit smoke-test for it so a base-image change that silently drops libass fails the build loudly instead of failing at render time with the confusing `ass=` filter error the gotcha describes.

```dockerfile
# worker/Dockerfile
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/vidgen-worker ./cmd/worker

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recursive \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# Fail the build loudly if this base image's ffmpeg lacks libass/the ass
# filter, instead of failing later at render time with the confusing
# "ass= filter" error described in the root CLAUDE.md gotchas.
RUN ffmpeg -filters 2>/dev/null | grep -q " ass " || \
    (echo "FATAL: ffmpeg build is missing the ass subtitle filter (libass)" && exit 1)

RUN pip install --no-cache-dir openai-whisper

WORKDIR /app
COPY --from=build /out/vidgen-worker /app/vidgen-worker

ENV NATS_URL=nats://nats:4222
ENV VIDGEN_ENV_PATH=/app/.env
ENV VIDGEN_CONFIG_PATH=/app/config.yaml
ENV FFMPEG_BIN=ffmpeg
ENV FFPROBE_BIN=ffprobe
ENV WHISPER_BIN=whisper

ENTRYPOINT ["/app/vidgen-worker"]
```

- [ ] **Step 2: Build the image**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite/worker
docker build -t vidgen-worker:dev .
```
Expected: exits 0; the `RUN ffmpeg -filters ... grep -q " ass "` layer prints nothing and does not trigger the `FATAL` echo (if it does trigger, STOP — this is a real gotcha reproduction, matching the root CLAUDE.md note, and needs the `homebrew-ffmpeg`-style tap analog for Debian, e.g. pinning a different base image, before continuing); final layer lists `Successfully tagged vidgen-worker:dev` (or the buildkit equivalent "naming to docker.io/library/vidgen-worker:dev").

- [ ] **Step 3: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add worker/Dockerfile
git commit -m "worker: add Dockerfile (ffmpeg+libass smoke-tested, whisper via pip)"
```

---

## Task 13: Extend `docker-compose.yml` with the `worker` service

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the current file (already read in full during research for this plan) and add the worker service + shared media volume**

Current `docker-compose.yml` (repo root) is:

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

Replace its full contents with:

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

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    depends_on:
      - nats
    environment:
      NATS_URL: nats://nats:4222   # compose DNS, container-internal port (index §8)
      VIDGEN_ENV_PATH: /app/.env
      VIDGEN_CONFIG_PATH: /app/config.yaml
    env_file:
      - ./.env   # FPT_TTS_API_KEY, PEXELS_API_KEY, PIXABAY_API_KEY, JAMENDO_CLIENT_ID (gitignored, root CLAUDE.md "Keys" section)
    volumes:
      - ./config.yaml:/app/config.yaml:ro
      - vidgen-media:/data/media   # shared with api (P1) for GET /media/<projectId>/<file> — see plan decision #8
    restart: unless-stopped

volumes:
  nats-data:
  vidgen-media:
```

- [ ] **Step 2: Validate the compose file**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
docker compose config --quiet
```
Expected: exits 0, no output (a non-zero exit or YAML error output means the file is malformed — fix before proceeding). Note: `docker compose config` will also warn/fail if `./.env` doesn't exist yet — the root project already has an `.env` (gitignored, per root `CLAUDE.md` "Keys" section), so this should be a non-issue in this repo, but if it errors on a fresh checkout, `touch .env` first.

- [ ] **Step 3: Build the worker service through compose**

Run:
```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
docker compose build worker
```
Expected: exits 0, same success criteria as Task 12 Step 2 (ffmpeg/libass smoke test layer passes silently).

- [ ] **Step 4: Confirm the nats service (currently running, unrelated to this change) is undisturbed**

Run:
```bash
docker compose ps
```
Expected: `nats` (container `webapp-rewrite-nats-1`) still listed as `Up`; `worker` is listed as built/created (not necessarily started, since this plan doesn't require running it against real provider credentials to complete).

- [ ] **Step 5: Commit**

```bash
cd /Users/cuongtran/Kanna/video-generation-skill/.worktrees/webapp-rewrite
git add docker-compose.yml
git commit -m "compose: add worker service (ffmpeg+whisper image, shared vidgen-media volume)"
```

---

## Self-Review

**1. Spec coverage** — every numbered item in the task's SCOPE maps to a task:

| Scope item | Task(s) |
|---|---|
| 1. `eventstore/`: Connect, ConsumeJobs, PublishResult, typed events, msgID | Tasks 2, 3, 4, 5 |
| 2. Re-point kept media packages; file-check demoted to cheap short-circuit | Task 1 (copy); Tasks 7-10 (`os.Stat` short-circuit kept in `MaterialHandler.resolve` / `TTSHandler`/`RenderHandler` retain the underlying provider behavior — `PublishResult` always runs regardless) |
| 3. `cmd/worker/main.go`: connect, 4 handlers, job payload carries all data, graceful shutdown | Task 11 |
| 4. `worker/go.mod`: module strategy decision, `go test ./...` green for media packages | Task 1 (Design decision #1: nested standalone module, not go.work; Step 5 is the drift-gauge run) |
| 5. `worker/Dockerfile` + compose `worker` service, libass gotcha | Tasks 12, 13 |
| Testing: TDD against running NATS, mirror D4 dedup test | Task 4 (`TestPublishResult_DedupByMsgID` is a direct structural mirror of `spikes/go-worker/worker_test.go`'s `TestPublishResultIsIdempotent`) |
| Testing: kept packages retain tests unmodified | Task 1 Step 2 (copies `*_test.go` verbatim) |
| Testing: adapter tests for job→media→event wiring, existing fake pattern | Tasks 7-10 (in-memory stub structs, same pattern as `internal/worker/worker_test.go`'s `stubTTS`) |
| Resource safety: targeted `go test ./worker/internal/eventstore/...`, not full-repo builds | Every task's verification step scopes `go test`/`go build` to `worker/internal/<pkg>/...`; Task 1 Step 6 is the one deliberate root-scope check, justified because Task 1 is the one task that could regress the root module |
| Field-name parity with TS event catalogue | Task 3 (`events_test.go` asserts every JSON key by substring match against `spikes/event-model/events.ts`'s field names) |

**2. Placeholder scan** — searched this document for "TBD", "similar to Task N", "add appropriate", "implement later": none found. Every code step contains complete, compilable Go (or Dockerfile/YAML) source, not a sketch. The one intentionally-superseded snippet (Task 7 Step 2's first `awaitEvent` draft) is explicitly labeled "replaced below" and immediately followed by the real implementation, so a reader executing top-to-bottom never lands on the placeholder as their final instruction.

**3. Type consistency vs the index and across this plan's own tasks:**
- Event JSON field names (`v`, `type`, `projectId`, `at`, `sceneIdx`, `source`, `assetPath`, `mp3Path`, `ttsUsd`, `assPath`, `outputPath`, `renderUsd`, `stage`, `error`) were checked one-by-one against `spikes/event-model/events.ts` while drafting Task 3 — exact match, including that `RunFailed` has no `sceneIdx` in the TS union (handled via decision #5's `json:"-"` field).
- `eventstore.Store.PublishResult(ctx, ev Event) (*jetstream.PubAck, error)` signature (Task 4) matches every call site in Tasks 6-10 (`h.store.PublishResult(ctx, ev)`) and the shared `publishFailure` helper (Task 6).
- `eventstore.ConsumeJobs[T any](ctx, s *Store, kind JobKind, durable string, handler JobHandler[T]) error` (Task 5) matches every call site in Task 11's `main.go` (4 calls, one per `JobKind`) and the test in Task 5 itself.
- `eventstore.JobKind` constants (`KindMaterial`, `KindTTS`, `KindCaption`, `KindRender`) defined once in Task 2's `store.go` and referenced identically in Tasks 5, 11 — no renaming drift.
- Job payload struct names (`MaterialJob`, `TTSJob`, `CaptionJob`, `SceneAudioRef`, `RenderJob`, `RenderSceneJob`, `RenderMusicJob`) defined once in Task 6's `types.go`, then used with identical field names in Tasks 7-10's handler code and tests — checked `job.ProjectID`, `job.SceneIdx`, `job.DestPath`, `job.Query`, `job.LocalAssetPath` (material); `job.Text`, `job.Voice`, `job.Speed` (tts); `job.SceneAudio`, `job.Style` (caption); `job.Scenes`, `job.ASSPath`, `job.Music`, `job.OutputPath` (render) all resolve to fields actually declared in Task 6.
- Handler constructor signatures (`NewMaterialHandler(source, probe, store)`, `NewTTSHandler(provider, store)`, `NewCaptionHandler(transcriber, writer, store)`, `NewRenderHandler(renderer, store)`) match their respective `Handle` method receivers and every call site in Task 11's `main.go` — cross-checked argument order and types (e.g. `material.DurationProbe(probe)` explicit conversion in `main.go`, mirroring the exact pattern already used in `internal/cli/root.go:106`).
- `Store.RawJetStream()` (introduced in Task 7 to support `awaitEvent`) is added to `store.go` in Task 7 but conceptually belongs with Task 2/4's `store.go` — flagged here for the executor: it's fine as written (Task 7 modifies a file Task 2/4 created, which the writing-plans format explicitly allows via "Modify:" file headers), but if tasks are dispatched to independent subagents out of order, Task 7 must run after Task 4.
- Verified against installed `nats.go@v1.52.0` source (not assumed from memory, per the Context7-first rule): `jetstream.ConsumerConfig.FilterSubjects []string` field exists; `Consumer.Fetch(batch int, opts ...FetchOpt) (MessageBatch, error)` signature; `jetstream.FetchMaxWait(time.Duration) FetchOpt` exists; `Stream.DeleteConsumer(ctx, name) error` exists; a natural fetch timeout with zero messages does not populate `batch.Error()` (read directly from `jetstream/pull.go`'s `fetch()` implementation, not inferred).

No unresolved gaps found.
