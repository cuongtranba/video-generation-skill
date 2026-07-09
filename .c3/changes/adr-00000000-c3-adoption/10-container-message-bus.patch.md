---
target: c3-2
scope: whole
type: container
parent: c3-0
title: Message bus / async execution plane
boundary: In-process embedded NATS JetStream server + worker consumers; no TCP port exposed
---
## Goal

Be the asynchronous execution plane that fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — decoupling job submission from job completion during `generate`.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Runs an embedded NATS server with JetStream persistence (started in-process by `c3-1`, no TCP port opened) carrying `VIDGEN_JOBS` and `VIDGEN_RESULTS` streams keyed by `(kind, project, scene)`. Owns the worker consumers that execute each job kind idempotently — checking output existence before doing paid or slow work so redelivery and re-runs cost nothing. Guarantees at-least-once delivery with idempotent effects; it does not own project state (that stays in `c3-1`'s manifest) or provider selection.
