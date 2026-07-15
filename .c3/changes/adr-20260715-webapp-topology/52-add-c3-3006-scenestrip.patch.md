---
target: c3-3006
scope: whole
type: component
parent: c3-30
title: SceneStrip — per-scene asset preview
---
## Goal

Render thumbnails and audio previews for each scene's resolved material and voiceover within TunePanel.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; reads materialPath and audioDurationSec from Zustand store |
| Status | active |

## Purpose

Owns SceneStrip rendering of scene visual thumbnail and MP3 audio preview. Non-goal: does not own approval logic.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Props typed with Scene type | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| SceneStrip | OUT | Renders scene material thumbnail and audio player for each scene | in-process | frontend/src/components/SceneStrip.tsx |

| SceneStrip.narration | OUT | Renders narration text for each scene | in-process | frontend/src/components/SceneStrip.tsx |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Scene.materialPath | Contract | N.A - undefined until MaterialResolved received | frontend/src/store/events.ts |
