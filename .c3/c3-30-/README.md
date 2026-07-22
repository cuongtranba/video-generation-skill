---
id: c3-30
c3-seal: 56ef325ac9622b3a1ec45d65ef694b4a1d96aeffb9b12790431d84467e6311bb
title: frontend — Vite/React/Zustand live event board
type: container
parent: c3-0
goal: Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before rendering.
---

## Goal

Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before rendering.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-3001 | store — Zustand state store and events mirror |  | active | Mirror the VidgenEvent union from api/src/events.ts, fold events with foldProject, and expose Zustand actions for dispatching commands to the api. |
| c3-3002 | natsClient — NATS WebSocket event subscription |  | active | Subscribe to VIDGEN_EVENTS over NATS WebSocket (nats.ws) to receive live events and update the Zustand store. |
| c3-3003 | Board — project list view |  | active | Render the live project board as a grid of ProjectCard components, one per known project. |
| c3-3004 | PipelineCard — per-project pipeline board card |  | active | Display a single project's status, cost, and primary actions (Generate Script, Resolve Material, etc.) derived from the Zustand projection. |
| c3-3008 | PipelineNode — pipeline step node |  | active | Render one pipeline step as a rail node: a tally light, label, per-step visualization, and engine/cost footer, selectable to drive the detail panel. |
| c3-3009 | StepDetail — selected step detail panel |  | active | Render the detail panel for the selected pipeline step: script lines, material media wells, voice waveform, caption karaoke, the approval gate actions, render output, or the failure error and retry. |
| c3-3010 | EventLog — worker event stream panel |  | active | Render the per-project NATS worker-event stream as time/type/message rows, tone-colored and auto-scrolled to the newest event. |
| c3-3011 | pipeline — pure step-state derivation model |  | active | Derive the pipeline board model — per-step state and cost, the active step, failures, the retry command map, the cost cap, formatted event rows, and media URLs — as pure functions with no React. |

## Responsibilities

Owns the browser UI: live event subscription, Zustand state projection, command dispatch to api HTTP endpoints, and all React components. Does not own any backend logic — it reads only from the api's Postgres projection (via HTTP) and NATS WebSocket events, and writes only via POST /api/commands/*.
