---
target: c3-104
scope: whole
type: component
parent: c3-1
category: foundation
title: cost — budget estimator & enforced ledger
---
## Goal

Project the USD cost of a video and enforce a hard per-video spending cap at both projection and execution time.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Foundation — the safety wall the flow cannot bypass |
| Depends on | c3-101 domain (`CostLineItem`, `Scene`) |
| Consumed by | c3-110 flow (confirm projects, generate enforces actual) |

## Purpose

Owns `Estimator` (projects per-character FPT.AI TTS cost across scenes) and `Ledger` (accumulates projected and actual line items, enforces `CapUSD` = 0.10 via `CheckProjected`/`CheckActual`). Non-goals: does not charge anything or call vendors — it accounts and gates.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-cost-wall | rule | Cap constant + both checks are load-bearing, never weakened | Authoritative | this component *is* the wall |
| rule-error-wrap | rule | Cap-exceeded errors wrap `ErrCostCapExceeded` with `%w` | Must | preserves sentinel for `errors.Is` |
| rule-di-constructor | rule | `NewEstimator()`/`NewLedger()` constructors, no global state | Must | ledger is per-project |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `Estimator.EstimateProject(scenes)` | IN | Returns projected line items (TTS is the only paid line) | Projection only | internal/cost/estimator.go |
| `Ledger.CheckProjected()` | IN | Errors if projected total > `CapUSD` | at confirm | internal/cost/ledger.go |
| `Ledger.CheckActual()` | IN | Errors if actual total > `CapUSD` | mid-generate, after each charge | internal/cost/ledger.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| cost cap tests | Contract | table cases around the cap boundary | internal/cost/ledger_test.go |
