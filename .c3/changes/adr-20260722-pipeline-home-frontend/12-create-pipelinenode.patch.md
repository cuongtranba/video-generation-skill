---
target: c3-3008
scope: whole
type: component
parent: c3-30
title: PipelineNode — pipeline step node
uses: [rule-no-any-data]
---
## Goal

Render one pipeline step as a rail node: a tally light, label, per-step visualization, and engine/cost footer, selectable to drive the detail panel.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; presentational, driven by a StepInfo prop |
| Status | active |

## Purpose

Owns the per-step node rendering inside PipelineCard's rail: the tally marker keyed off step state (pending/running/done/awaiting/failed), the step-specific viz (script type bars, material wells, voice waveform, caption karaoke words, gate text, render progress), and the click-to-select affordance. Non-goal: does not derive step state or own the rail layout/edges — that is the pipeline model component and PipelineCard.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Props typed with StepInfo/StepState/Scene; no any on the viz switch | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| PipelineNode | OUT | Renders a step node with tally, label, viz, and engine/cost footer | in-process | frontend/src/components/PipelineNode.tsx |
| PipelineNode.onSelect | OUT | Invokes the select callback so PipelineCard routes the detail panel to this step | in-process | frontend/src/components/PipelineNode.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| data-state attribute | Contract | N.A - one of pending/running/done/awaiting/failed | frontend/src/components/PipelineNode.tsx |
