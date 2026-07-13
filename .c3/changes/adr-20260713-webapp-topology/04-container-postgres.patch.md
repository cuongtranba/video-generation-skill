---
target: c3-6
scope: whole
type: container
parent: c3-0
boundary: External Postgres service (docker-compose postgres), disposable — fully rebuildable by replaying VIDGEN_EVENTS from sequence 0
---
## Goal

Hold the queryable read-model projections (`projects`, `scenes`, `assets`, `cost_ledger`) that `api` materializes from the event log, so baseline REST reads do not require folding the full event stream on every request.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Stores derived, disposable state only — never the source of truth. DROP + replay from VIDGEN_EVENTS seq 0 must fully rebuild every table.
