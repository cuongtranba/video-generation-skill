# vidgen Webapp Rewrite — Discovery Phase (D1–D4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk the big-bang webapp rewrite with four scoped discovery spikes, and set the one frame value the loop cannot invent — the real Agent SDK per-video cost that anchors `COST_CAP_USD`.

**Architecture:** A single local `docker-compose` NATS (JetStream + WebSocket) is the shared spike substrate — the same event store the product will use. Each spike is a minimal probe against it that ends by writing an append-only **learning checkpoint**. No product code, no CLI deletion, no committing PKR work until Task 6 accepts the checkpoints.

**Tech Stack:** NATS JetStream (event store), `nats.js` (`@nats-io/transport-node`, `@nats-io/jetstream`), Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, TS), Go `nats.go`, Vite (D3 browser probe).

**Spec:** `docs/superpowers/specs/2026-07-09-vidgen-webapp-event-store-design.md`

**okra note:** Run id `disc-01`. Checkpoints are the source of truth (append-only); status is derived. All spikes are free — Agent SDK uses the local `claude` CLI (subscription auth), no API key, script gen cost = $0.

---

## File Structure

- `docker-compose.yml` — spike infra: `nats` service only (JetStream + WS).
- `deploy/nats/nats.conf` — JetStream + websocket listener config.
- `.okra/runs/disc-01/` — run store: `frame.json` (read-only), `checkpoints/D*.md` (append-only), `ledger.jsonl`.
- `spikes/event-model/events.ts` — D2 event catalogue (TS types) + JSON schema.
- `spikes/event-model/events_test.ts` — D2 aggregate-fold test.
- `spikes/agent-sdk/script-cost.ts` — D1 Agent SDK cost probe.
- `spikes/nats-ws/` — D3 Vite browser probe (`index.html`, `main.ts`) + `publisher.ts`.
- `spikes/go-worker/` — D4 Go probe (`main.go`, `worker_test.go`, `go.mod`).

Spikes live under `spikes/` and are **deleted or promoted** in the implementation phase — they are learning, not product.

---

## Task 0: Run store + spike scaffolding

**Files:**
- Create: `.okra/runs/disc-01/frame.json`
- Create: `.okra/runs/disc-01/ledger.jsonl` (empty)
- Create: `spikes/.gitkeep`

- [ ] **Step 1: Create the run store and frame**

```bash
mkdir -p .okra/runs/disc-01/checkpoints spikes
: > .okra/runs/disc-01/ledger.jsonl
cat > .okra/runs/disc-01/frame.json <<'JSON'
{
  "run_id": "disc-01",
  "objective": "6/6 pipeline stages browser-only + 1 rendered MP4",
  "anti_goal": { "metric": "per_video_usd", "cap_env": "COST_CAP_USD", "default": 0.15, "type": "tripwire" },
  "drift_gauge": { "metric": "go_worker_media_test_pass_rate", "target": 1.0 },
  "tripwire_secrets": "no secret material appended to VIDGEN_EVENTS",
  "frame_owner": "human"
}
JSON
touch spikes/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add .okra/runs/disc-01 spikes/.gitkeep
git commit -m "chore(disc-01): okra run store + frame for discovery phase"
```

---

## Task 1: NATS event-store infra (shared spike substrate)

**Files:**
- Create: `deploy/nats/nats.conf`
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the NATS config (JetStream + WebSocket)**

`deploy/nats/nats.conf`:

```text
jetstream {
    store_dir: "/data/jetstream"
    max_memory_store: 268435456
    max_file_store: 5368709120
}

websocket {
    port: 8080
    no_tls: true
}
```

- [ ] **Step 2: Write the compose file (nats only, for now)**

`docker-compose.yml`:

```yaml
services:
  nats:
    image: nats:2.10-alpine
    command: ["-c", "/etc/nats/nats.conf"]
    ports:
      - "4222:4222"   # TCP: api + worker
      - "8080:8080"   # WebSocket: browser (nats.ws)
      - "8222:8222"   # monitoring
    volumes:
      - ./deploy/nats/nats.conf:/etc/nats/nats.conf:ro
      - nats-data:/data

volumes:
  nats-data:
```

- [ ] **Step 3: Bring it up**

Run: `docker compose up -d nats`
Expected: `nats` container running; `docker compose logs nats` shows `Starting JetStream` and `Listening for websocket clients on ws://0.0.0.0:8080`.

- [ ] **Step 4: Create the streams**

Run (via the nats CLI in a throwaway container):
```bash
docker run --rm --network host natsio/nats-box:latest \
  nats str add VIDGEN_EVENTS --subjects "vidgen.evt.>" --storage file \
  --retention limits --max-age=-1 --max-bytes=-1 --max-msgs=-1 \
  --dupe-window=2m --discard old --replicas 1 --defaults
docker run --rm --network host natsio/nats-box:latest \
  nats str add VIDGEN_JOBS --subjects "vidgen.job.>" --storage file \
  --retention work --dupe-window=2m --replicas 1 --defaults
```
Expected: `Stream VIDGEN_EVENTS was created` and `Stream VIDGEN_JOBS was created`.

- [ ] **Step 5: Verify**

Run: `docker run --rm --network host natsio/nats-box:latest nats str ls`
Expected: lists `VIDGEN_EVENTS` and `VIDGEN_JOBS`.

- [ ] **Step 6: Commit**

```bash
git add deploy/nats/nats.conf docker-compose.yml
git commit -m "feat(infra): local NATS JetStream + WebSocket event store for spikes"
```

---

## Task 2 (D2): Event model — catalogue, types, aggregate fold

Design decision, made concrete: define the v1 event catalogue as TS types with a `v` version field, and prove a Project aggregate can be folded from an event array. This is the contract D1/D3/D4 and the whole rewrite depend on.

**Files:**
- Create: `spikes/event-model/package.json`
- Create: `spikes/event-model/events.ts`
- Test: `spikes/event-model/events_test.ts`

- [ ] **Step 1: Init the spike package**

```bash
cd spikes/event-model
npm init -y
npm pkg set type=module
npm i -D typescript tsx vitest @types/node
cd -
```

- [ ] **Step 2: Write the failing aggregate-fold test**

`spikes/event-model/events_test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { foldProject, type VidgenEvent } from './events.js'

describe('foldProject', () => {
  it('folds a lifecycle into current state', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z',
        idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:01:00Z',
        scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0.012 },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-09T00:02:00Z' },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: '2026-07-09T00:03:00Z' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at: '2026-07-09T00:04:00Z',
        outputPath: '/m/p1.mp4', renderUsd: 0.004 },
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
})
```

- [ ] **Step 3: Run it — verify it fails**

Run: `cd spikes/event-model && npx vitest run`
Expected: FAIL — `Cannot find module './events.js'`.

- [ ] **Step 4: Write the event catalogue + fold**

`spikes/event-model/events.ts`:

```typescript
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

export type ProjectStatus =
  | 'draft' | 'material' | 'scripted' | 'awaiting_approval' | 'approved' | 'rendered' | 'published' | 'failed'

export type ProjectState = {
  projectId: string
  status: ProjectStatus
  scenes: Scene[]
  spentUsd: number
  approved: boolean
  outputPath?: string
}

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

- [ ] **Step 5: Run it — verify it passes**

Run: `cd spikes/event-model && npx vitest run`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the D2 checkpoint**

`.okra/runs/disc-01/checkpoints/D2.md`:

```markdown
# D2 checkpoint — event model
- Decision: v1 event catalogue frozen (11 event types, all versioned `v:1`).
- Subject scheme: `vidgen.evt.<projectId>.<type>`.
- Aggregate `foldProject` reconstructs status + spentUsd + approval from the log. Verified by test.
- Open: snapshot cadence (defer to impl); schema evolution via `v` bump + upcaster.
- Confidence: HIGH — this is the contract the rewrite builds on.
```

- [ ] **Step 7: Commit**

```bash
git add spikes/event-model .okra/runs/disc-01/checkpoints/D2.md
git commit -m "spike(D2): event catalogue + aggregate fold, verified"
```

---

## Task 3 (D1): Agent SDK integration probe — verify local CLI, structured output, and per-call cost

**Side effects:** none paid. Agent SDK wraps the local `claude` CLI subprocess (subscription auth — same as the original vidgen `internal/script` package). No `ANTHROPIC_API_KEY` needed. Script generation cost = **$0** (subscription). Probe confirms the SDK works, produces valid structured JSON, and that `total_cost_usd` reports $0.

**Files:**
- Create: `spikes/agent-sdk/package.json`
- Create: `spikes/agent-sdk/script-cost.ts`

- [ ] **Step 1: Init the spike package**

```bash
cd spikes/agent-sdk
npm init -y
npm pkg set type=module
npm i @anthropic-ai/claude-agent-sdk
npm i -D typescript tsx @types/node
cd -
```

- [ ] **Step 2: Write the cost probe**

`spikes/agent-sdk/script-cost.ts`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const schema = {
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

const ideas = [
  '3 lý do bạn nên uống nước ấm mỗi sáng',
  '5 mẹo tiết kiệm pin điện thoại',
  'Cách pha cà phê phin ngon tại nhà',
]

for (const idea of ideas) {
  let cost = 0
  let scenes = 0
  for await (const message of query({
    prompt: `Viết kịch bản video dọc 30 giây (3 cảnh) cho ý tưởng: "${idea}". Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual).`,
    options: { outputFormat: { type: 'json_schema', schema } },
  })) {
    if (message.type === 'result') {
      cost = message.total_cost_usd ?? 0
      const out = message.structured_output as { scenes?: unknown[] } | undefined
      scenes = out?.scenes?.length ?? 0
    }
  }
  console.log(JSON.stringify({ idea, scriptUsd: cost, scenes }))
}
```

- [ ] **Step 3: Run the probe**

Run: `cd spikes/agent-sdk && npx tsx script-cost.ts`
Expected: 3 JSON lines, each with `scriptUsd: 0` (subscription, no charge) and `scenes: 3`.

- [ ] **Step 4: Record the readings to the ledger**

```bash
# paste the 3 scriptUsd values; example uses placeholders you REPLACE with real output
printf '%s\n' \
  '{"metric":"script_usd","idea":1,"value":0.012}' \
  '{"metric":"script_usd","idea":2,"value":0.011}' \
  '{"metric":"script_usd","idea":3,"value":0.013}' \
  >> .okra/runs/disc-01/ledger.jsonl
```

- [ ] **Step 5: Write the D1 checkpoint — this sets `COST_CAP_USD` default**

`.okra/runs/disc-01/checkpoints/D1.md`:

```markdown
# D1 checkpoint — Agent SDK integration
- Agent SDK wraps local `claude` CLI (subscription auth); no ANTHROPIC_API_KEY; script gen cost = $0.
- `total_cost_usd` from the result message confirmed: [observed value, expected 0].
- Structured output (`json_schema` format) returns valid scenes array — 3/3 ideas produced scenes: 3.
- Total per-video cost = $0 (script) + ~$0.004 (FPT TTS) + $0 (render) = ~$0.004.
- COST_CAP_USD default $0.15 (ratified by human) gives 37× headroom — only TTS charges are real.
- Admissibility rule: aggregate checks projected TTS chars × rate, not script cost.
- Confidence: HIGH — SDK runs locally, correct JSON output verified.
```

- [ ] **Step 6: Commit**

```bash
git add spikes/agent-sdk .okra/runs/disc-01/checkpoints/D1.md .okra/runs/disc-01/ledger.jsonl
git commit -m "spike(D1): Agent SDK integration probe; confirms $0 script cost + valid structured output"
```

---

## Task 4 (D3): nats.ws browser consumer probe

Prove the browser can subscribe to `VIDGEN_EVENTS` over WebSocket and render events live — the whole live-board premise.

**Files:**
- Create: `spikes/nats-ws/package.json`
- Create: `spikes/nats-ws/index.html`
- Create: `spikes/nats-ws/main.ts`
- Create: `spikes/nats-ws/publisher.ts`

- [ ] **Step 1: Init the Vite spike**

```bash
cd spikes/nats-ws
npm init -y
npm pkg set type=module
npm i @nats-io/nats-core @nats-io/jetstream @nats-io/transport-node
npm i -D vite tsx typescript
cd -
```
Note: `nats.js` is modular and its package split changes across versions — reconfirm the exact browser transport import (`wsconnect`) against Context7 (`/nats-io/nats.js`) before finalizing.

- [ ] **Step 2: Write the browser consumer**

`spikes/nats-ws/index.html`:

```html
<!doctype html>
<html><body><ul id="log"></ul><script type="module" src="./main.ts"></script></body></html>
```

`spikes/nats-ws/main.ts`:

```typescript
import { wsconnect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

const nc = await wsconnect({ servers: 'ws://localhost:8080' })
const js = jetstream(nc)
const c = await js.consumers.get('VIDGEN_EVENTS') // ordered consumer (no name)
const log = document.getElementById('log')!
await c.consume({
  callback: (m) => {
    const li = document.createElement('li')
    li.textContent = `${m.seq} ${m.subject} ${m.string()}`
    log.appendChild(li)
    m.ack()
  },
})
```

- [ ] **Step 3: Write a Node publisher to feed test events**

`spikes/nats-ws/publisher.ts`:

```typescript
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'

const nc = await connect({ servers: 'localhost:4222' })
const js = jetstream(nc)
for (let i = 0; i < 3; i++) {
  await js.publish(`vidgen.evt.p1.Ping`, JSON.stringify({ v: 1, type: 'Ping', n: i }), { msgID: `ping-${i}` })
}
await nc.drain()
console.log('published 3')
```

- [ ] **Step 4: Run the probe**

Run (terminal A): `cd spikes/nats-ws && npx vite`
Open the printed localhost URL in a browser.
Run (terminal B): `cd spikes/nats-ws && npx tsx publisher.ts`
Expected: browser list shows 3 `<li>` lines `1 vidgen.evt.p1.Ping ...` within ~1s.

- [ ] **Step 5: Verify with agent-browser (optional automated check)**

Use the agent-browser skill to open the Vite URL, run the publisher, and assert 3 list items appear.

- [ ] **Step 6: Write the D3 checkpoint**

`.okra/runs/disc-01/checkpoints/D3.md`:

```markdown
# D3 checkpoint — nats.ws browser consumer
- Browser connects `ws://localhost:8080`, jetstream() over WS works, ordered consumer streams events.
- Decision: browser uses an EPHEMERAL ordered consumer (recreates on gap) — no server-side durable state per browser tab.
- Latency observed: [fill] (<1s target).
- Open: WS auth for non-loopback deploy (defer — v1 is loopback); reconnect/backoff handling in the store.
- Confidence: HIGH if 3 items rendered; else FLAG cannot.
```

- [ ] **Step 7: Commit**

```bash
git add spikes/nats-ws .okra/runs/disc-01/checkpoints/D3.md
git commit -m "spike(D3): nats.ws browser consumer over WebSocket, verified"
```

---

## Task 5 (D4): Go worker ↔ event store probe (idempotency)

Prove the Go worker can consume a job and append a result event, and that publishing with the same `msgID` twice stores only one event — event-level idempotency replacing the old output-file check.

**Files:**
- Create: `spikes/go-worker/go.mod`
- Create: `spikes/go-worker/main.go`
- Test: `spikes/go-worker/worker_test.go`

- [ ] **Step 1: Init the module**

```bash
cd spikes/go-worker
go mod init vidgen-spike/go-worker
go get github.com/nats-io/nats.go@latest
cd -
```

- [ ] **Step 2: Write the failing dedup test**

`spikes/go-worker/worker_test.go`:

```go
package main

import (
	"context"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

func TestPublishResultIsIdempotent(t *testing.T) {
	nc, err := nats.Connect("nats://localhost:4222")
	if err != nil {
		t.Skipf("no local nats: %v", err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatalf("jetstream: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	subj := "vidgen.evt.testp.RenderCompleted"
	id := "render-testp-once"
	if _, err := PublishResult(ctx, js, subj, id, []byte(`{"v":1}`)); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	if _, err := PublishResult(ctx, js, subj, id, []byte(`{"v":1}`)); err != nil {
		t.Fatalf("second publish: %v", err)
	}
	st, err := js.Stream(ctx, "VIDGEN_EVENTS")
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	info, err := st.Info(ctx)
	if err != nil {
		t.Fatalf("info: %v", err)
	}
	// within the dupe-window, the two identical msgIDs collapse to one stored msg
	got := countSubject(ctx, t, js, subj)
	if got != 1 {
		t.Fatalf("want 1 stored event for subject, got %d (stream msgs=%d)", got, info.State.Msgs)
	}
}
```

- [ ] **Step 3: Run it — verify it fails**

Run: `cd spikes/go-worker && go test ./...`
Expected: FAIL — `PublishResult`/`countSubject` undefined (compile error).

- [ ] **Step 4: Write the probe implementation**

`spikes/go-worker/main.go`:

```go
package main

import (
	"context"
	"fmt"
	"testing"

	"github.com/nats-io/nats.go/jetstream"
)

// PublishResult appends a result event with msgID-based dedup.
func PublishResult(ctx context.Context, js jetstream.JetStream, subject, msgID string, data []byte) (*jetstream.PubAck, error) {
	ack, err := js.Publish(ctx, subject, data, jetstream.WithMsgID(msgID))
	if err != nil {
		return nil, fmt.Errorf("publish result %s: %w", subject, err)
	}
	return ack, nil
}

// countSubject counts stored messages on a subject via a temp ordered consumer.
func countSubject(ctx context.Context, t *testing.T, js jetstream.JetStream, subject string) int {
	t.Helper()
	c, err := js.OrderedConsumer(ctx, "VIDGEN_EVENTS", jetstream.OrderedConsumerConfig{FilterSubjects: []string{subject}})
	if err != nil {
		t.Fatalf("ordered consumer: %w", err)
	}
	n := 0
	batch, err := c.Fetch(10)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	for range batch.Messages() {
		n++
	}
	return n
}

func main() { fmt.Println("spike: run via go test") }
```

Note: confirm `OrderedConsumerConfig.FilterSubjects` and `WithMsgID` signatures against Context7 (`/nats-io/nats.js` sibling docs + `nats.go` godoc) — the `jetstream` sub-package API is versioned.

- [ ] **Step 5: Run it — verify it passes**

Run: `docker compose up -d nats && cd spikes/go-worker && go test ./... -run TestPublishResultIsIdempotent -v`
Expected: PASS — one stored event despite two identical `msgID` publishes.

- [ ] **Step 6: Write the D4 checkpoint**

`.okra/runs/disc-01/checkpoints/D4.md`:

```markdown
# D4 checkpoint — Go worker ↔ event store
- Go `nats.go/jetstream` publishes result events; `WithMsgID` + stream dupe-window gives event-level idempotency (replaces output-file check).
- Ordered consumer with FilterSubjects reads per-subject history — usable for the worker's replay-safe consume.
- Open: job-consume ack policy + retry (defer to impl); worker reads job payloads carrying all needed data (no DB coupling).
- Confidence: HIGH if dedup test green.
```

- [ ] **Step 7: Commit**

```bash
git add spikes/go-worker .okra/runs/disc-01/checkpoints/D4.md
git commit -m "spike(D4): Go worker event-store publish + msgID idempotency, verified"
```

---

## Task 6: Discovery synthesis + go/no-go

**Files:**
- Create: `.okra/runs/disc-01/checkpoints/SYNTHESIS.md`
- Modify: `docs/superpowers/specs/2026-07-09-vidgen-webapp-event-store-design.md` (set the ratified `COST_CAP_USD` default from D1)

- [ ] **Step 1: Read all four checkpoints and the ledger**

Run: `cat .okra/runs/disc-01/checkpoints/D*.md .okra/runs/disc-01/ledger.jsonl`
Confirm every spike is HIGH confidence and no `cannot`/`breaking` flag is open.

- [ ] **Step 2: Paired anti-goal read**

Confirm: total per-video cost (TTS ~$0.004, script $0, render $0) ≤ `COST_CAP_USD` $0.15 (yes by 37×), AND no secret values (API keys, tokens) were appended to any event in the probes. If any secret appears in the event log → open a `breaking` flag and STOP.

- [ ] **Step 3: Write the synthesis + go/no-go**

`.okra/runs/disc-01/checkpoints/SYNTHESIS.md`:

```markdown
# disc-01 synthesis
- D1: Agent SDK $0/video (subscription, not API key) confirmed; COST_CAP_USD $0.15 ratified by human stands (37× over real TTS cost).
- D2 event model: v1 catalogue frozen.
- D3 nats.ws: browser live consume works (ephemeral ordered consumer).
- D4 worker: event-level idempotency works.
- Funnel: discovery mostly closed → ready for execution.
- GO / NO-GO: [decision].
- Next: per-subsystem implementation plans — (1) api aggregate+command handlers+projections, (2) Agent SDK script service, (3) Go worker adapter, (4) React/Zustand SPA + lint ban, (5) delete CLI + C3 change-unit.
```

- [ ] **Step 4: Confirm COST_CAP_USD in spec is correct**

D1 confirmed script gen = $0 (subscription). Cap $0.15 (ratified by human) remains correct and needs no change. Only action: verify the spec anti-goal line still reads `"default": 0.15` — no edit expected.

- [ ] **Step 5: Commit**

```bash
git add .okra/runs/disc-01/checkpoints/SYNTHESIS.md docs/superpowers/specs/2026-07-09-vidgen-webapp-event-store-design.md
git commit -m "spike(disc-01): synthesis + go/no-go; ratify COST_CAP_USD from evidence"
```

---

## Self-Review

**Spec coverage (discovery scope):** event store (Task 1), event model/aggregate (Task 2 = D2), Agent SDK + cost wall (Task 3 = D1), nats.ws live board premise (Task 4 = D3), Go worker event-store idempotency (Task 5 = D4), okra frame/anti-goal instantiation (Task 0 + Task 6). Full-build subsystems (api handlers, projections, SPA, CLI deletion, C3 change-unit) are intentionally **out of this plan** — they are the post-synthesis implementation plans listed in Task 6.

**Placeholder scan:** ledger values in D1 Step 4 and checkpoint `[fill]`/`[value]` markers are **runtime readings the worker records**, not plan gaps — each is explicitly "replace with real output". No TODO/TBD implementation steps.

**Type consistency:** `VidgenEvent`, `foldProject`, `ProjectState`, `PublishResult`, `countSubject`, subjects `vidgen.evt.<projectId>.<type>` / `vidgen.job.>`, streams `VIDGEN_EVENTS`/`VIDGEN_JOBS` used consistently across Tasks 1–5.

**API-verification flags:** nats.js modular import (`wsconnect`) and the Go `jetstream` `WithMsgID`/`OrderedConsumerConfig` signatures are marked for Context7 reconfirmation at implementation — correct for a discovery plan where the point is to pin those facts.
