---
id: ref-ref-event-contract
c3-seal: 2821f5dfd9b33fc23183c81fc1cc8766a1ee910631904b8bba2f835a3e46c769
title: ref-event-contract
type: ref
goal: 'Standardize the payload shape that crosses the api↔worker↔frontend boundary so all three subsystems remain interoperable without runtime negotiation. The problem: events emitted by the TypeScript api are consumed by the Go worker and echoed to the React frontend; a field-name or type mismatch causes silent deserialization failures that only surface at runtime under load.'
---

## Goal

Standardize the payload shape that crosses the api↔worker↔frontend boundary so all three subsystems remain interoperable without runtime negotiation. The problem: events emitted by the TypeScript api are consumed by the Go worker and echoed to the React frontend; a field-name or type mismatch causes silent deserialization failures that only surface at runtime under load.

## Choice

A frozen TypeScript union (`VidgenEvent` in `api/src/events.ts`) is the canonical source of truth. Go structs in `worker/internal/eventstore/events.go` and the TypeScript mirror in `frontend/src/store/events.ts` must match it field-for-field. JSON field names are camelCase throughout (Go uses explicit `json:"<camelCase>"` tags). Every event carries `v: 1` for future versioning. The frozen scheme is documented in the ADR `adr-20260715-webapp-topology`.

## Why

The api, worker, and frontend are written in two languages (TypeScript and Go) and run as separate processes communicating over NATS JetStream. An informal "we'll keep them in sync" policy breaks down during parallel feature work — a Go struct field renamed in a PR on the worker branch silently breaks api deserialization. A single canonical union forces the contract to be explicit and searchable. TypeScript was chosen as the source because the api authors the initial event schema and the frontend mirrors it directly; Go tags are the derived artifact, not the source.

Alternatives considered: protobuf/avro (rejected — adds a schema registry and codegen step that outweighs the benefit at this team size); separate schema file (rejected — a third file goes stale faster than the canonical union that the api's own tests exercise every run).

The two authorized post-P3 contract extensions confirm the pattern works under change pressure:

- `StyleSet` + `TuneProject` (P4): added as a new union member without touching existing members.
- `VoiceSynthesized.durationSec` + `ApproveStoryboard` readiness gate (P3→P4 boundary): added a new required field; Go struct and frontend store updated in the same PR, gated by the `c3 check` clean run.

## How

Canonical union (TypeScript, single source):

```
api/src/events.ts  — VidgenEvent union, 12 members, all carry v:1+type+projectId+at
```

Go mirror (must match field-for-field, camelCase json tags):

```
worker/internal/eventstore/events.go  — MaterialResolved, VoiceSynthesized (DurationSec float64 `json:"durationSec"`), CaptionsBuilt, RenderCompleted, RunFailed
```

Frontend mirror (TypeScript, must match api/src/events.ts):

```
frontend/src/store/events.ts  — VidgenEvent union mirrored for Zustand store
```

REQUIRED: Every new event type must be added to all three files in the same PR. REQUIRED: Go struct json tags must use camelCase matching the TypeScript field name. OPTIONAL: `v` field may be used for future migration; current contract is always v:1.
