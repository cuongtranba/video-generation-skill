---
target: c3-3007
scope: whole
type: component
parent: c3-30
title: StoryboardApproval — approval gate widget
---
## Goal

Block or enable the ApproveStoryboard action based on per-scene readiness flags from the Zustand projection.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; reads ProjectState from Zustand store |
| Status | active |

## Purpose

Owns StoryboardApproval rendering: shows pending scenes (missing audioDurationSec or materialPath) and disables the approve button until all scenes are ready and captionsReady is true. Non-goal: does not own the actual approval command dispatch — that is TunePanel.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Props typed with ProjectState; no any on readiness checks | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| StoryboardApproval.isReady | OUT | True when all scenes have audioDurationSec + materialPath and captionsReady === true | in-process | frontend/src/components/StoryboardApproval.tsx |

| StoryboardApproval.pendingScenes | OUT | Lists scene indices that are still missing material or audio | in-process | frontend/src/components/StoryboardApproval.tsx |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Readiness check | Contract | N.A - must stay in sync | frontend/src/components/StoryboardApproval.tsx |
