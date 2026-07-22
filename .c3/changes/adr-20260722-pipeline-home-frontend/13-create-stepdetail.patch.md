---
target: c3-3009
scope: whole
type: component
parent: c3-30
title: StepDetail — selected step detail panel
uses: [rule-no-any-data]
---
## Goal

Render the detail panel for the selected pipeline step: script lines, material media wells, voice waveform, caption karaoke, the approval gate actions, render output, or the failure error and retry.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; reads ProjectState + event log, dispatches step/retry commands |
| Status | active |

## Purpose

Owns the footer detail panel PipelineCard renders for whichever step is selected. Renders real media (image/video wells and mp3 audio players from /media paths) for material and voice, the approve/reject actions for the awaiting gate, the output.mp4 player when render is done, and the failure error plus a step-scoped retry when a step failed. Absorbs the approval and per-scene preview surfaces retired from TunePanel/SceneStrip/StoryboardApproval. Non-goal: does not compute step state or event rows — that is the pipeline model component.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | ProjectState/Scene/StepInfo typed props; retry command map typed | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| StepDetail | OUT | Renders the selected step's detail body keyed off step key + state | in-process | frontend/src/components/StepDetail.tsx |
| StepDetail.actions | OUT | Dispatches the step's command (generate/approve/reject/retry) via the Zustand store | in-process | frontend/src/components/StepDetail.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Media URLs | Contract | N.A - mapped from event paths via mediaUrl | frontend/src/pipeline/media.ts |
| Retry command | Contract | N.A - stage→command from the pipeline model | frontend/src/pipeline/derive.ts |
