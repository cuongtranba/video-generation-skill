---
target: c3-105
scope: whole
type: component
parent: c3-1
category: foundation
title: videogen — AI clip-generation seam
---
## Goal

Provide a stable interface seam for future AI clip-generation providers so config and wiring have a contract before any implementation exists.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Foundation — a contract-only seam, no live provider yet |
| Depends on | Go stdlib (`context`) only |
| Consumed by | c3-102 config (`videogen` selection), future material/render wiring |

## Purpose

Owns the `ClipGenerator` interface plus `ClipRequest`/`ClipResult` value types — the contract a Runway/Kling-style provider will satisfy. Non-goals: implements no provider; it exists purely so provider selection and downstream wiring compile against a fixed seam.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| ref-provider-seam | ref | Clip-gen follows the same interface+factory seam as other categories | Authoritative | seam defined ahead of impl |
| rule-no-any-data | rule | Request/Result are concrete structs | Must | typed `ClipRequest`/`ClipResult` |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `ClipGenerator.Generate(ctx, req, dest)` | IN/OUT | Produces a clip at `dest` from a prompt; returns path + duration | No live impl (config default `none`) | internal/videogen/videogen.go |
| `ClipRequest` / `ClipResult` | IN/OUT | Value types carrying prompt/dimensions and result path/duration | Stable seam | internal/videogen/videogen.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| future clip-gen provider | Contract | any vendor honoring the seam | internal/videogen/videogen.go |
