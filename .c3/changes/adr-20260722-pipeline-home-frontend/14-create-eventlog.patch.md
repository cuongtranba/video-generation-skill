---
target: c3-3010
scope: whole
type: component
parent: c3-30
title: EventLog — worker event stream panel
uses: [rule-no-any-data]
---
## Goal

Render the per-project NATS worker-event stream as time/type/message rows, tone-colored and auto-scrolled to the newest event.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | feature |
| Boundary | Browser React component; reads the per-project event log from the Zustand store |
| Status | active |

## Purpose

Owns the "worker events · nats" panel inside PipelineCard: maps each folded VidgenEvent to a formatted row (timecode, dotted type token, terse message, tone) via the pipeline model's formatEvent, and pins the scroll to the latest row as events stream in. Non-goal: does not format the events itself — the mapping is the pure formatEvent in the pipeline model component.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Rows typed with VidgenEvent/EventRow; no any at the event boundary | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| EventLog | OUT | Renders formatted event rows for one project, newest pinned to view | in-process | frontend/src/components/EventLog.tsx |
| EventLog.autoscroll | OUT | Scrolls the log to the newest row when the event count changes | in-process | frontend/src/components/EventLog.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| Event rows | Contract | N.A - formatEvent output | frontend/src/pipeline/eventFormat.ts |
