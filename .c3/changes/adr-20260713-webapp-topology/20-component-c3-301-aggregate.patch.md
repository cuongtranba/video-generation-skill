---
target: c3-301
scope: whole
type: component
parent: c3-3
category: foundation
title: aggregate — event catalogue & Project fold
---
## Goal

Define the frozen event catalogue and fold a project's event stream into its current ProjectState, so every command handler and every projection reads the same deterministic truth.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-3 api |
| Layer | Foundation — depended on by commands-http, projections |
| Depends on | none (pure functions over the event union) |
| Consumed by | c3-302 commands-http, c3-305 projections |

## Purpose

Owns the VidgenEvent TS union (11 types, v:1, promoted verbatim from spikes/event-model/events.ts) and foldProject(events) → ProjectState. Non-goals: no I/O, no NATS/Postgres calls — pure state-transition logic only.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-no-any-data | rule | VidgenEvent/ProjectState modeled as concrete typed unions/interfaces | Must | no any/unnarrowed unknown |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| foldProject(events) | IN/OUT | Deterministic reduce over ordered events → ProjectState | Pure, no side effects | api/src/aggregate.ts |
| VidgenEvent union | IN/OUT | 11 frozen event shapes, field shapes not alterable without a spec change | index §4 frozen | api/src/events.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| frontend's incremental fold (applyEvent) | Contract | must reuse the same fold logic, not reimplement it | frontend/src/store/store.ts |
