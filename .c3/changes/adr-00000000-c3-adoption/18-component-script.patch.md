---
target: c3-111
scope: whole
type: component
parent: c3-1
category: feature
title: script — idea to scene script via claude CLI
---
## Goal

Turn a raw video idea into a structured, scene-by-scene Vietnamese narration script.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Feature — first pipeline step, produces the scenes everything else consumes |
| Depends on | c3-103 prereq (`claude` binary), c3-101 domain (`Scene`) |
| Consumed by | c3-110 flow (create/material steps) |

## Purpose

Owns `Generator` and its `ClaudeCLIGenerator` implementation, which shells out to the `claude` CLI and parses the response envelope (handling both the array-of-messages and single-object shapes) into domain `Scene`s. Non-goals: no rendering, no TTS — text only.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-di-constructor | rule | `var _ Generator = (*ClaudeCLIGenerator)(nil)`; injected binary path | Must | compile-time seam check |
| rule-error-wrap | rule | CLI/parse errors wrapped with op context | Must | wraps exec + json errors |
| rule-tdd-table-tests | rule | Envelope parsing covered by table tests over both shapes | Must | array + object cases |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `Generator.Generate(ctx, idea)` | IN/OUT | Produces ordered `Scene`s with Vietnamese narration | Runs on claude subscription (free to project cost) | internal/script/generator.go |
| envelope parsing | IN | Accepts both array-of-messages and single-object claude output | Both shapes | internal/script/generator.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| script tests (faked claude) | Contract | shell-script fake CLI | internal/script/generator_test.go |
