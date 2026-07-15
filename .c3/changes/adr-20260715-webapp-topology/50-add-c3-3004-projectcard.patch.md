---
target: c3-3004
scope: whole
type: component
parent: c3-30
title: ProjectCard — per-project status card
---
## Goal

Display a single project's status, cost, and primary pipeline actions derived from the Zustand projection.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; dispatches commands via Zustand store |
| Status | active |

## Purpose

Owns ProjectCard rendering (status badge, CostBadge, command buttons) and action dispatch. Non-goal: does not own TunePanel — that is a separate component.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Props typed with ProjectState; action handlers typed | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| ProjectCard | OUT | Renders status, cost, and action buttons for one project | in-process | frontend/src/components/ProjectCard.tsx |

| CostBadge | OUT | Renders spent USD cost formatted as $N.NN | in-process | frontend/src/components/CostBadge.tsx |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Action button visibility | Contract | N.A - must reflect current status | frontend/src/components/ProjectCard.tsx |
