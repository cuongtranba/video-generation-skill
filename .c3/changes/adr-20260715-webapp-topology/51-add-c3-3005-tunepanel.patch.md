---
target: c3-3005
scope: whole
type: component
parent: c3-30
title: TunePanel — style tuning and storyboard approval panel
---
## Goal

Let the user set voice, speed, caption style, and music before voiceover dispatch, and approve the storyboard once all scenes are ready.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; dispatches TuneProject + ApproveStoryboard commands via Zustand store |
| Status | active |

## Purpose

Owns TunePanel (voice/speed/caption/music controls, SceneStrip per scene, StoryboardApproval gate). The TuneProject command corresponds to the StyleSet event. Non-goal: does not own the approval readiness check — that is StoryboardApproval.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | TuneInput typed; music field accepts object or null | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| TunePanel.onTune | OUT | Dispatches TuneProject command with partial StyleSpec fields | in-process | frontend/src/components/TunePanel.tsx |
| TunePanel.onApprove | OUT | Dispatches ApproveStoryboard command | in-process | frontend/src/components/TunePanel.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Voice options | Contract | N.A - exact match | frontend/src/components/TunePanel.tsx |
