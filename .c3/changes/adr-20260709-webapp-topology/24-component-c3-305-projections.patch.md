---
target: c3-305
scope: whole
type: component
parent: c3-3
category: foundation
title: projections — event log to Postgres read models
---
## Goal

Run a durable consumer on VIDGEN_EVENTS that materializes every event into Postgres tables (projects, scenes, assets, cost_ledger), so baseline REST reads never require replaying the full event stream.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-3 api |
| Layer | Foundation — the CQRS read side |
| Depends on | c3-301 aggregate (shares fold logic), Postgres |
| Consumed by | c3-302 commands-http (baseline reads) |

## Purpose

Owns the durable NATS consumer and the Postgres migration/schema (api/migrations/001_init.sql), plus periodic aggregate snapshots. Non-goals: never the source of truth — DROP + replay from seq 0 must fully rebuild every table.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-no-any-data | rule | Postgres row types are concrete TS interfaces, not any | Must | typed query results |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| durable consumer on VIDGEN_EVENTS | IN | Folds each event into its Postgres table, idempotent on replay | Postgres is disposable | api/src/projections.ts |
| DROP + full replay | IN/OUT | Truncate all tables and replay from VIDGEN_EVENTS seq 0 must fully rebuild state | No irreversible data | api/src/projections.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| Postgres schema | Contract | migrations only, no manual DDL | api/migrations/001_init.sql |
