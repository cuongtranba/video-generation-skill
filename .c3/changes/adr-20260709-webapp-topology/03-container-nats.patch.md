---
target: c3-5
scope: whole
type: container
parent: c3-0
boundary: External NATS JetStream service (docker-compose nats), file-backed persistence, TCP for services + WebSocket for the browser
---
## Goal

Be the append-only event store and job queue that is the system's single source of truth: `VIDGEN_EVENTS` (subjects `vidgen.evt.<projectId>.<eventType>`, limits/none retention for full replay) and `VIDGEN_JOBS` (subjects `vidgen.job.<kind>.<projectId>.<scene>`, work-queue retention), reachable by `api`/`worker` over TCP and by the browser directly over WebSocket.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Persists every domain event durably and in order per project; guarantees at-least-once job delivery to `worker`; deduplicates event appends via `Nats-Msg-Id` (2-minute window). Owns no business logic.
