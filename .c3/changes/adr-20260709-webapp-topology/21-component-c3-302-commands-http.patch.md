---
target: c3-302
scope: whole
type: component
parent: c3-3
category: foundation
title: commands-http — command handlers, dispatch & REST surface
---
## Goal

Be the composition root and write-side entrypoint: validate every command against the folded aggregate and cost admissibility, append the resulting event(s), dispatch worker jobs, serve the SPA/baseline/media over HTTP.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-3 api |
| Layer | Feature — the orchestrator over aggregate/cost/script/projections |
| Depends on | c3-301 aggregate, c3-303 cost, c3-304 script, c3-305 projections |
| Consumed by | frontend (HTTP), worker (job dispatch) |

## Purpose

Owns the 7 frozen command handlers (CreateProject, GenerateScript, ResolveMaterial, GenerateVoiceovers, RequestApproval, ApproveStoryboard, Publish — index §5), each folding the aggregate, checking invariants + cost admissibility before dispatch, appending events with idempotency-key-derived Nats-Msg-Id. Also owns the Publish command's actual TikTok upload call (absorbing the old internal/publish responsibility). Non-goals: no media work, no direct Postgres writes.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-cost-wall | rule | Every spend-triggering command checks projected cost before dispatch | Authoritative | via c3-303 cost |
| rule-no-any-data | rule | Command bodies are concrete typed interfaces, no any | Must | one interface per command |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| POST /api/commands/<name> | IN | Validates, appends event(s), dispatches jobs | idempotencyKey required | api/src/commands.ts, api/src/http.ts |
| GET /api/state, GET /api/projects/:id | OUT | Reads from Postgres projection | Baseline only, not source of truth | api/src/http.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| frontend command thunks | Contract | one thunk per command, same body shape | frontend/src/store/store.ts |
