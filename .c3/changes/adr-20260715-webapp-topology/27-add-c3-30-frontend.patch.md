---
target: c3-30
scope: whole
type: container
parent: c3-0
title: frontend — Vite/React/Zustand live event board
---
## Goal

Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before rendering.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-3001 | store — Zustand state store and events mirror | foundation | active | Mirror the VidgenEvent union from api/src/events.ts, fold events with foldProject, and expose Zustand actions for dispatching commands to the api. |
| c3-3002 | natsClient — NATS WebSocket event subscription | foundation | active | Subscribe to VIDGEN_EVENTS over NATS WebSocket (nats.ws) to receive live events and update the Zustand store. |
| c3-3003 | Board — project list view | feature | active | Render the live project board as a grid of ProjectCard components, one per known project. |
| c3-3004 | ProjectCard — per-project status card | feature | active | Display a single project's status, cost, and primary actions (Generate Script, Resolve Material, etc.) derived from the Zustand projection. |
| c3-3005 | TunePanel — style tuning and storyboard approval panel | feature | active | Let the user set voice, speed, caption style, and music before voiceover dispatch, and approve the storyboard once all scenes are ready. |
| c3-3006 | SceneStrip — per-scene asset preview | feature | active | Render thumbnails and audio previews for each scene's resolved material and voiceover within TunePanel. |
| c3-3007 | StoryboardApproval — approval gate widget | feature | active | Block or enable the ApproveStoryboard action based on per-scene readiness flags from the Zustand projection. |

## Responsibilities

Owns the browser UI: live event subscription, Zustand state projection, command dispatch to api HTTP endpoints, and all React components. Does not own any backend logic — it reads only from the api's Postgres projection (via HTTP) and NATS WebSocket events, and writes only via POST /api/commands/*.
