---
id: c3-2
c3-seal: bc62698e7ffc2365e22d4b0452bb7f77bfb2c80716a0b1a370632fe187712004
title: Message bus / async execution plane
type: container
parent: c3-0
goal: Be the asynchronous execution plane that fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — decoupling job submission from job completion during `generate`.
---

## Goal

Be the asynchronous execution plane that fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — decoupling job submission from job completion during `generate`.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-201 | bus — embedded NATS JetStream messaging |  | active | Provide the in-process, persistent message transport that carries generation jobs and results between the flow and its workers. |
| c3-210 | worker — idempotent job consumers |  | active | Execute each generation job kind idempotently off the bus so re-runs and redelivery never repeat paid or slow work. |

## Responsibilities

Runs an embedded NATS server with JetStream persistence (started in-process by `c3-1`, no TCP port opened) carrying `VIDGEN_JOBS` and `VIDGEN_RESULTS` streams keyed by `(kind, project, scene)`. Owns the worker consumers that execute each job kind idempotently — checking output existence before doing paid or slow work so redelivery and re-runs cost nothing. Guarantees at-least-once delivery with idempotent effects; it does not own project state (that stays in `c3-1`'s manifest) or provider selection.
