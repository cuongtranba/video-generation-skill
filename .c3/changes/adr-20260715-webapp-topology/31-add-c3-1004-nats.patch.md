---
target: c3-1004
scope: whole
type: component
parent: c3-10
title: nats — event store, job publisher, and projection consumer wiring
---
## Goal

Provide the EventStore (VIDGEN_EVENTS read/append) and dispatchJob (VIDGEN_JOBS publish), and wire the durable projections consumer on startup.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-10 api |
| Category | foundation |
| Boundary | In-process module; depends on external NATS JetStream server (nats:4222 inside Docker Compose) |
| Status | active |

## Purpose

Owns connectBus, ensureStreams (VIDGEN_EVENTS workqueue + VIDGEN_JOBS), EventStore interface + createEventStore, publishEvent, dispatchJob, ensureDurableConsumer, consumeEvents. Deterministic msgID scheme: `<type>-<projectId>-<sceneIdx|->` collapses duplicates within the 2-minute JetStream dupe window. Non-goal: does not own projection logic — that is projections.ts.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | JobPayload and all message types use concrete typed fields | high | No any on published payloads |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| EventStore.loadEvents | OUT | Reads VIDGEN_EVENTS filtered by projectId via ephemeral ordered consumer | in-process | api/src/nats.ts |
| dispatchJob | OUT | Publishes to VIDGEN_JOBS with deterministic msgID `<kind>-<projectId>-<sceneIdx>` | to NATS JetStream | api/src/nats.ts |
| DUPLICATE_WINDOW_NS | OUT | 2-minute dupe window constant; both streams use this | config | api/src/nats.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| worker/internal/eventstore/store.go | Contract | N.A - exact match required | worker/internal/eventstore/store.go |
