---
target: c3-2002
scope: whole
type: component
parent: c3-20
title: eventstore — result event structs and publisher
---
## Goal

Define the worker-side result event structs mirroring api/src/events.ts and publish them to VIDGEN_EVENTS after each job completes.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | foundation |
| Boundary | In-process Go; publishes to NATS JetStream VIDGEN_EVENTS |
| Status | active |

## Purpose

Owns MaterialResolved, VoiceSynthesized, CaptionsBuilt, RenderCompleted, RunFailed Go structs with camelCase JSON tags mirroring the TypeScript VidgenEvent union; the Event interface (Subject()/MsgID()); and the PublishResult function. MsgID scheme mirrors api/src/nats.ts: `<type>-<projectId>-<sceneIdx|->`. Non-goal: does not own event fold or aggregate logic — those are api concerns.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | All event structs use concrete typed fields; no interface{} | high | Typed JSON tags for the NATS wire format |
| rule-error-wrap | rule | Publish errors wrapped with fmt.Errorf | high | Store.go wraps NATS publish errors |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| VoiceSynthesized.DurationSec | OUT | float64 durationSec in JSON — enables api/src/commands.ts approveStoryboard readiness gate | NATS event to api | worker/internal/eventstore/events.go |
| Event interface | OUT | Subject() + MsgID() — every result event implements this for correct publish | in-process | worker/internal/eventstore/events.go |
| RunFailed.MsgID | OUT | Includes Stage to prevent dedup collision when multiple stages fail for same project in dupe window | NATS event to api | worker/internal/eventstore/events.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Event struct JSON field names | Contract | Go uses PascalCase field names with camelCase json: tags | worker/internal/eventstore/events.go |
