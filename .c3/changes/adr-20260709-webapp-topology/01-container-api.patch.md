---
target: c3-3
scope: whole
type: container
parent: c3-0
boundary: TypeScript/Node service; command handlers, Project aggregate, Agent SDK script generation, cost admissibility, projections, serves the SPA + media
---
## Goal

Be the write-side and read-side composition root for the webapp: validate and admit every command against the Project aggregate and the cost wall, append the resulting events to the NATS event store, dispatch media jobs to the worker, materialize Postgres read models from the event log, and serve the frontend SPA plus rendered media over HTTP.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Owns the command surface (`POST /api/commands/<name>`), the Project aggregate (`foldProject`), the Claude Agent SDK script-generation service, the cost ledger and `COST_CAP_USD` admissibility check, the durable projection consumer that materializes `VIDGEN_EVENTS` into Postgres, and the REST baseline (`GET /api/state`, `GET /api/projects/:id`, `GET /media/<projectId>/<file>`). Delegates media work (tts/material/caption/render) to the `worker` container via job events; never does media work itself.
