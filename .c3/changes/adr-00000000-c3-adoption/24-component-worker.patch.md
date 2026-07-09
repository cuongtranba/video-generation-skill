---
target: c3-210
scope: whole
type: component
parent: c3-2
category: feature
title: worker — idempotent job consumers
---
## Goal

Execute each generation job kind idempotently off the bus so re-runs and redelivery never repeat paid or slow work.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-2 message bus / async plane |
| Layer | Feature — the execution side of the async plane |
| Depends on | c3-201 bus, c3-113 audio-synthesis, c3-114 visual-assembly, c3-112 material, c3-101 domain |
| Consumed by | c3-110 flow (starts workers, awaits results during generate) |

## Purpose

Owns the typed job/result messages (`TTSJob`/`TTSResult`, `MaterialJob`, `CaptionJob`, `RenderJob`, …) and the consumers that run them: parallel per-scene TTS, then caption, then render. Each consumer checks its output file exists before working and skips if so. Non-goals: no orchestration ordering policy (flow owns that), no vendor selection.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| ref-idempotent-worker | ref | Output-exists check precedes every paid/slow op | Authoritative | worker *is* the pattern |
| rule-no-any-data | rule | Jobs/results are concrete typed structs across the bus | Must | internal/worker/types.go |
| rule-error-wrap | rule | Job failures reported via result `Error`, internal errors wrapped | Must | typed error channel |
| rule-tdd-table-tests | rule | Consumer idempotency covered by table tests | Must | skip-on-exists cases |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| TTS/caption/render consumers | IN/OUT | Consume a job, produce the artifact, publish a typed result | One artifact per `(kind, project, scene)` | internal/worker/worker.go |
| output-exists skip | IN | If `DestPath` exists, reuse it and skip the paid/slow op | $0 re-run | internal/worker/worker.go |
| result reporting | OUT | Failures carried in `*Result.Error`, not panics | Typed results | internal/worker/types.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| worker tests | Contract | faked providers, temp output dirs | internal/worker/worker_test.go |
