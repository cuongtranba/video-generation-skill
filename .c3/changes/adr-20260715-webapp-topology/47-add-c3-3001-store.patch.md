---
target: c3-3001
scope: whole
type: component
parent: c3-30
title: store — Zustand state store and events mirror
---
## Goal

Mirror the VidgenEvent union from api/src/events.ts, fold events with foldProject, and expose Zustand actions for dispatching commands to the api.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | foundation |
| Boundary | Browser in-process; calls api HTTP endpoints for command dispatch |
| Status | active |

## Purpose

Owns the Zustand store (projects map keyed by projectId), foldProject mirror, handleEvent (dispatch to fold reducer), and command dispatch actions (createProject, generateScript, tuneProject, etc.) that POST to /api/commands/*. Non-goal: does not own the NATS WebSocket connection — that is natsClient.ts.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Store state uses typed ProjectState; no any on store actions or selectors | high | TypeScript discriminated union |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| handleEvent | IN | Folds an incoming VidgenEvent into the projects map | in-process | frontend/src/store/store.ts |
| dispatchCommand | OUT | POST /api/commands/:name with typed body | HTTP to api | frontend/src/store/store.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| frontend/src/store/events.ts | Contract | N.A - must be kept in sync | frontend/src/store/events.ts |
