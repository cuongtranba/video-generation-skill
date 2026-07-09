---
target: c3-201
scope: whole
type: component
parent: c3-2
category: foundation
title: bus — embedded NATS JetStream messaging
---
## Goal

Provide the in-process, persistent message transport that carries generation jobs and results between the flow and its workers.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-2 message bus / async plane |
| Layer | Foundation — the transport every worker and the flow bind to |
| Depends on | `nats-server/v2`, `nats.go`, `nats.go/jetstream` |
| Consumed by | c3-110 flow (publishes jobs, reads results), c3-210 worker (consumes jobs) |

## Purpose

Owns `Bus` — an embedded NATS server with JetStream persistence started in-process (no TCP port), the `VIDGEN_JOBS`/`VIDGEN_RESULTS` streams, the `JobKind` enum (tts/material/caption/render), and the `JobSubject`/`ResultSubject` addressing scheme keyed by `(kind, project, scene)`. Non-goals: does no media work and holds no project state.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-di-constructor | rule | `NewEmbedded(storeDir)` constructor, no global server | Must | server owned by instance |
| rule-error-wrap | rule | Server start / publish / consume errors wrapped with op context | Must | wraps NATS errors |
| rule-no-any-data | rule | Job/result payloads are concrete typed structs, JSON-encoded | Must | see worker types |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `NewEmbedded(storeDir)` | IN/OUT | Starts in-process NATS+JetStream; connects a client, no TCP port | Single process only | internal/bus/bus.go |
| `JobSubject`/`ResultSubject` | OUT | Deterministic subject per `(kind, project, scene)` | 4 job kinds | internal/bus/bus.go |
| stream delivery | IN/OUT | At-least-once; redelivery expected (workers must be idempotent) | JetStream persistence | internal/bus/bus.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| bus tests | Contract | in-process server in temp store | internal/bus/bus_test.go |
