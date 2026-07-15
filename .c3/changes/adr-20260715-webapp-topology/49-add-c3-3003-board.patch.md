---
target: c3-3003
scope: whole
type: component
parent: c3-30
title: Board — project list view
---
## Goal

Render the live project board as a grid of ProjectCard components, one per known project.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; reads from Zustand store |
| Status | active |

## Purpose

Owns the Board component that maps the Zustand projects map to a grid of ProjectCard components. Non-goal: does not own project-level actions — those are in ProjectCard and TunePanel.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Props typed with ProjectState; no any on component props | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Board | OUT | Renders ProjectCard for each project in the store | in-process | frontend/src/components/Board.tsx |

| onCreateProject | OUT | Dispatches CreateProject command via Zustand store action | in-process | frontend/src/components/Board.tsx |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Zustand store selector | Contract | N.A - same order as /api/state | frontend/src/store/store.ts |
