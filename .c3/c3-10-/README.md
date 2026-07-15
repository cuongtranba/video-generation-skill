---
id: c3-10
c3-seal: 37e97b076ca66dff77179f63085e17847ead3f9f98004a438d0d0d40b1aedd0d
title: api — TypeScript/Bun event-sourced command surface
type: container
parent: c3-0
goal: Be the HTTP command surface, event store, aggregate fold, Postgres projection engine, cost wall, and Agent SDK script service that owns project truth in NATS JetStream and projects it to a Postgres read model.
---

## Goal

Be the HTTP command surface, event store, aggregate fold, Postgres projection engine, cost wall, and Agent SDK script service that owns project truth in NATS JetStream and projects it to a Postgres read model.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-1001 | events — frozen event catalogue and foldProject |  | active | Define the VidgenEvent union and foldProject reducer that is the cross-language contract and the source of aggregate state. |
| c3-1002 | aggregate — command-transition guards |  | active | Assert that a project exists and that commands are legal from the current status, providing the state-machine gate. |
| c3-1003 | commands — command handlers and dispatcher |  | active | Implement every user-facing command (CreateProject, GenerateScript, TuneProject, ResolveMaterial, GenerateVoiceovers, RequestApproval, ApproveStoryboard, Publish), enforcing the cost wall and dispatching jobs. |
| c3-1004 | nats — event store, job publisher, and projection consumer wiring |  | active | Provide the EventStore (VIDGEN_EVENTS read/append) and dispatchJob (VIDGEN_JOBS publish), and wire the durable projections consumer. |
| c3-1005 | projections — Postgres read model |  | active | Consume VIDGEN_EVENTS via a durable NATS consumer and fold every event into Postgres tables (projects, scenes, assets, cost_ledger) for the HTTP read path. |
| c3-1006 | cost — budget estimator and enforced cost wall |  | active | Project TTS cost and enforce the per-video cost cap before dispatching voiceover jobs; maintain the cost ledger in Postgres. |
| c3-1007 | script — Agent SDK scene generator |  | active | Use the Anthropic Agent SDK (claude-agent-sdk) to turn a video idea into a structured scene list; expose sdkScriptGenerator satisfying the ScriptGenerator interface. |
| c3-1008 | http — HTTP command surface and static file server |  | active | Route POST /api/commands/* to command handlers, serve GET /api/state and project detail endpoints from the Postgres projection, and serve the SPA and media files. |
| c3-1009 | db — Postgres connection wrapper |  | active | Provide a thin typed Database wrapper over the pg client for projections and the cost ledger. |

## Responsibilities

Owns the command surface (HTTP POST /api/commands/*), event appending to NATS JetStream (VIDGEN_EVENTS), job dispatch to NATS JetStream (VIDGEN_JOBS), Postgres projection maintenance, the cost wall enforced before TTS jobs are dispatched, Agent SDK scene generation, and static SPA + media serving. Does not own job execution — that is the worker container.
