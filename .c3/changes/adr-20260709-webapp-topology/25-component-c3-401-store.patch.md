---
target: c3-401
scope: whole
type: component
parent: c3-4
category: foundation
title: store — Zustand single-store, nats.ws, commands
---
## Goal

Be the single Zustand store owning the browser's NATS connection, event-fold state, derived selectors, and every command dispatch — so components stay pure.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-4 frontend |
| Layer | Foundation — the only stateful module in the frontend |
| Depends on | nats.ws (wsconnect, @nats-io/jetstream), c3-301's fold logic (mirrored client-side) |
| Consumed by | every component in frontend/src/components/** |

## Purpose

Owns the store surface: state (projects, connection, selectedId), applyEvent(subject, VidgenEvent) incremental fold, the 7 command thunks (createProject...publish, each POST /api/commands/*), and lifecycle (connect()/disconnect()). Non-goals: components never hold local state or call fetch/nats.ws directly.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-ui-state-in-store | rule | All state/logic lives here, not in components | Authoritative | this component is the rule's one legal home for state |
| rule-no-any-data | rule | ProjectState/event payloads typed, no any | Must | mirrors c3-301's types |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| connect() | IN/OUT | wsconnect + ordered VIDGEN_EVENTS consumer + fold loop | Browser-only | frontend/src/store/store.ts |
| command thunks | IN/OUT | One thunk per frozen command, POST /api/commands/<name> | idempotencyKey generated client-side | frontend/src/store/store.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| store tests | Contract | mocked NATS + fetch, unit-test each thunk | frontend/src/store/store.test.ts |
