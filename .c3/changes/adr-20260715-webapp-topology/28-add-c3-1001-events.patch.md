---
target: c3-1001
scope: whole
type: component
parent: c3-10
title: events — frozen event catalogue and foldProject
---
## Goal

Define the VidgenEvent union and the foldProject reducer that are the cross-language contract between api, worker, and frontend, and the single source of aggregate state.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-10 api |
| Category | foundation |
| Boundary | In-process module; imported by aggregate, commands, projections, http, and nats |
| Status | active |

## Purpose

Owns the VidgenEvent discriminated union (12 event types, v:1 version field, camelCase JSON), the StyleSpec type, the DEFAULT_STYLE constant, and the foldProject pure reducer that replays events into ProjectState. Non-goal: does not own persistence, HTTP, or job dispatch — it is pure domain types and the fold function.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | VidgenEvent union must use concrete typed fields — no any or untyped maps | high | TypeScript discriminated union with literal type: field |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| VidgenEvent | OUT | Discriminated union of 12 concrete event types; payload keys are the cross-language frozen contract | api-to-worker via NATS JSON; api-to-frontend via WebSocket | api/src/events.ts |
| foldProject | OUT | Pure function: VidgenEvent[] → ProjectState; idempotent; used by commands to load state and by tests to verify fold | in-process call | api/src/events.ts |
| StyleSpec / DEFAULT_STYLE | OUT | TuneProject command and StyleSet event payload shape | in-process | api/src/events.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| worker/internal/eventstore/events.go | Contract | Go struct names differ; json tags must match | worker/internal/eventstore/events.go |
| frontend/src/store/events.ts | Contract | N.A - exact copy with TypeScript import | frontend/src/store/events.ts |
