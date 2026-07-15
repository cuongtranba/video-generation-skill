---
target: c3-2001
scope: whole
type: component
parent: c3-20
title: jobhandler — material, tts, caption, render handlers
---
## Goal

Implement the four job handler types with output-exists idempotency and publish result events to VIDGEN_EVENTS.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | feature |
| Boundary | In-process Go; consumes VIDGEN_JOBS, publishes to VIDGEN_EVENTS |
| Status | active |

## Purpose

Owns MaterialJob, TTSJob, CaptionJob, RenderJob, RenderSceneJob, RenderMusicJob concrete types (camelCase JSON tags); and the handler functions for each job kind. Every handler: (1) computes deterministic DestPath, (2) stats the file — if exists, publishes the cached result event and acks; (3) otherwise executes the work and publishes the result event. Non-goal: does not own provider adapters — those are in tts/, material/, music/, render/ packages.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-idempotent-worker | ref | Output-exists check must precede every paid/slow operation in every handler | high | DestPath stat is the canonical idempotency gate |
| rule-no-any-data | rule | All job struct fields use concrete types (domain.Voice, domain.Speed, float64, string) | high | No any or interface{} for job data |
| rule-di-constructor | rule | Handler functions receive injected provider interfaces, not concrete vendor types | high | Compile-time var _ I = (*T)(nil) checks |
| rule-error-wrap | rule | All errors returned from handlers are wrapped with fmt.Errorf("op: %w", err) | high | No bare return err |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| MaterialJob | IN | {projectId, sceneIdx, query, localAssetPath?, destPath} — camelCase JSON | from VIDGEN_JOBS | worker/internal/jobhandler/types.go |
| TTSJob | IN | {projectId, sceneIdx, text, voice, speed, destPath} — camelCase JSON | from VIDGEN_JOBS | worker/internal/jobhandler/types.go |
| CaptionJob | IN | {projectId, sceneAudio[], style, destPath} | from VIDGEN_JOBS | worker/internal/jobhandler/types.go |
| RenderJob | IN | {projectId, scenes[], assPath, music?, outputPath} | from VIDGEN_JOBS | worker/internal/jobhandler/types.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| JSON field names on job structs | Contract | N.A - camelCase throughout; CaptionJob.style snake_case keys are a documented inconsistency | worker/internal/jobhandler/types.go |
