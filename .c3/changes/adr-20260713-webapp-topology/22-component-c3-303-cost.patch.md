---
target: c3-303
scope: whole
type: component
parent: c3-3
category: foundation
title: cost — budget projection & the enforced ledger
---
## Goal

Project the USD cost of a video and enforce COST_CAP_USD at both projection (before dispatch) and actual (read from the ledger after a run), so a misconfigured or runaway run can never spend beyond budget.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-3 api |
| Layer | Foundation — the safety wall c3-302 cannot bypass |
| Depends on | c3-301 aggregate |
| Consumed by | c3-302 commands-http |

## Purpose

Owns cost projection (FPT.AI TTS chars × rate + render $0) and the admissibility check that vetoes a command (dry-run, no side effect) if projected cost exceeds COST_CAP_USD. Reads actual spend from the cost_ledger Postgres projection. Non-goals: never sums Agent SDK total_cost_usd into the enforced total — ScriptGenerated.scriptUsd is always 0.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-cost-wall | rule | Cap constant (COST_CAP_USD, default 0.15) + both checks never removed/weakened | Authoritative | this component is the wall |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| projectCost(state) | IN/OUT | Projects total USD from scenes/state; excludes Agent SDK notional cost | Projection only | api/src/cost.ts |
| admit(projected) | IN | Returns veto if projected > COST_CAP_USD | Dry-run, before dispatch | api/src/cost.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| cost cap tests | Contract | table cases around the cap boundary | api/src/cost.test.ts |
