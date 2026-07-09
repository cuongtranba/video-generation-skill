---
target: c3-106
scope: whole
type: component
parent: c3-1
category: foundation
title: cli — cobra command surface & composition root
---
## Goal

Be the composition root: parse commands, resolve prerequisites and config, wire every provider, and dispatch to the flow.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Foundation — the entrypoint that assembles all other components |
| Depends on | c3-102 config, c3-103 prereq, c3-104 cost, c3-101 domain, c3-110 flow, all provider factories |
| Consumed by | `cmd/vidgen/main.go` (thin `main` calls into it) |

## Purpose

Owns the cobra command tree and `app.init`, which runs prereq checks, loads `.env` + `config.yaml`, validates secrets, builds each provider via its `NewFromConfig` factory, constructs the `Flow`, and dispatches subcommands. Non-goals: no pipeline step logic of its own — it wires and delegates.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-di-constructor | rule | Providers injected into `Flow` via constructor, no globals | Must | `app` struct holds wired deps |
| rule-error-wrap | rule | Init/dispatch errors wrapped with op context | Must | fail fast on missing dep |
| ref-provider-seam | ref | Construction goes through each category's `NewFromConfig` | Must | cli is the seam's single caller |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `app.init(baseDir, cfgPath)` | IN | Verifies prereqs, loads/validates config, wires providers + flow | Fails fast on any missing dep | internal/cli/root.go |
| cobra command tree | IN/OUT | Maps subcommands (create/generate/publish/…) to flow calls | One process, terminal-invoked | internal/cli/root.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| `cmd/vidgen/main.go` | Purpose | thin main only | cmd/vidgen/main.go |
