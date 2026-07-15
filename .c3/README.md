---
id: c3-0
c3-seal: ce67791e995b664e2961e83952026d896a8cac7f333e009a01c7c556b3bb7366
title: video-generation-skill
goal: Turn a single video idea into a finished, publish-ready 9:16 Vietnamese-voiced short — idea → script → stock material → FPT.AI TTS → whisper captions → FFmpeg render → platform upload — as one cost-capped, event-sourced webapp pipeline.
---

## Goal

Turn a single video idea into a finished, publish-ready 9:16 Vietnamese-voiced short — idea → script → stock material → FPT.AI TTS → whisper captions → FFmpeg render → platform upload — as one cost-capped, event-sourced webapp pipeline.

## Containers

| ID | Name | Boundary | Status | Responsibilities | Goal Contribution |
| --- | --- | --- | --- | --- | --- |
| c3-10 | api — TypeScript/Bun event-sourced command surface |  | active | Be the HTTP command surface, event store, aggregate fold, Postgres projection engine, cost wall, and Agent SDK script service that owns project truth in NATS JetStream and projects it to a Postgres read model. | Be the HTTP command surface, event store, aggregate fold, Postgres projection engine, cost wall, and Agent SDK script service that owns project truth in NATS JetStream and projects it to a Postgres read model. |
| c3-20 | worker — Go idempotent job consumers |  | active | Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempotently, publishing result events back to VIDGEN_EVENTS. | Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempotently, publishing result events back to VIDGEN_EVENTS. |
| c3-30 | frontend — Vite/React/Zustand live event board |  | active | Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before rendering. | Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before rendering. |

## Abstract Constraints

| Constraint | Rationale | Affected Containers |
| --- | --- | --- |
| Hard per-video cost cap (configurable via COST_CAP_USD env, default $0.15), enforced at projection before TTS dispatch | Prevents any run from overspending on paid vendor calls (FPT.AI TTS is the only paid per-character line) | c3-10 |
| Project state is event-sourced: the source of truth is NATS JetStream VIDGEN_EVENTS; a Postgres projection gives the read model | The long, multi-vendor pipeline must survive crashes and let the UI show live progress; events replay to rebuild state | c3-10 |
| Every external vendor in the worker sits behind a config-selected factory + interface seam | Vendors churn; swapping or adding one must not touch job-handler callers, and secrets stay in .env | c3-20 |
| Asynchronous job work is idempotent: output-exists check before any paid/slow op | Re-runs and JetStream redelivery must cost $0 and never duplicate artifacts | c3-20 |
| External binaries (ffmpeg/ffprobe/whisper) resolved and verified by the worker at startup | Fail fast with a clear message rather than mid-render; honoring FFMPEG_BIN/FFPROBE_BIN/WHISPER_BIN env overrides | c3-20 |
