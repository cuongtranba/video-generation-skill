---
id: adr-20260722-pipeline-home-frontend
c3-seal: 1168cc325c2f4ecc71353698c3e55cf650911957db791efa7a9ca68ffd03d74e
title: pipeline-home-frontend
type: adr
goal: 'Replace the frontend home screen — a vertical list of per-project status cards (ProjectCard + TunePanel + SceneStrip + StoryboardApproval) — with the "Pipeline Home" board imported from Claude Design: each project renders as a full-width pipeline card showing six step nodes (script → material → voiceover → captions → approval gate → render) with live per-step visualizations, a step detail panel, and a NATS worker-event log. The event model, commands, and cost wall are unchanged; only the frontend presentation and component topology change.'
status: accepted
date: "2026-07-22"
---

## Goal

Replace the frontend home screen — a vertical list of per-project status cards (ProjectCard + TunePanel + SceneStrip + StoryboardApproval) — with the "Pipeline Home" board imported from Claude Design: each project renders as a full-width pipeline card showing six step nodes (script → material → voiceover → captions → approval gate → render) with live per-step visualizations, a step detail panel, and a NATS worker-event log. The event model, commands, and cost wall are unchanged; only the frontend presentation and component topology change.

## Context

The frontend container (c3-30) modeled the SPA as ProjectCard (c3-3004) composing three child feature components: TunePanel (c3-3005, voice/speed/caption/music tuning), SceneStrip (c3-3006, per-scene preview), and StoryboardApproval (c3-3007, the approval gate). Two forces made this shape stale: (1) ElevenLabs is now the only TTS provider with a fixed voice, so the voice/speed/caption/music tuning surface is dead UI (adr-20260721-tts-provider-ui already reduced TunePanel to a read-only label); (2) the Claude Design "Pipeline Home" deliverable reframes the whole screen around the event-sourced pipeline itself — nodes, edges, and the worker event stream — rather than a form-driven card. The design was implemented strictly (user decision), so the tuning and upload surfaces leave the home screen entirely.

## Decision

Retire c3-3005/c3-3006/c3-3007 (TunePanel, SceneStrip, StoryboardApproval — the tuning/preview/approval-form triad). Reshape c3-3004 from "ProjectCard — per-project status card" into "PipelineCard — per-project pipeline board card": the card header, a six-node rail with flow edges, and a detail+log footer. Approval moves into the gate step's detail panel (Approve storyboard / Reject & rescript buttons). Add three presentational child components — PipelineNode (c3-3008), StepDetail (c3-3009), EventLog (c3-3010) — and one pure model component, pipeline (c3-3011), holding deriveSteps / formatEvent / mediaUrl (table-tested, no React). Board (c3-3003) now renders PipelineCard. This keeps the container's per-component granularity, isolates the pure step-state derivation for testing, and preserves the frozen event contract untouched.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-3003 | component | Now renders PipelineCard instead of a ProjectCard grid | c3-3003#n807@v1:sha256:9d63eab7778edeb2352f4dd52e445001fa27352ea579a1e30c54f78f958ca842 "Render the live project board as a grid of ProjectCard components, one per known project." | rule-no-any-data: props stay typed with ProjectState |
| c3-3004 | component | Reshaped from status card to pipeline board card | c3-3004#n831@v1:sha256:521f55ad33402d4ca25f3e048fabd42248ec813cddfdfbf64e14e865418092e0 "Display a single project's status, cost, and primary pipeline actions derived from the Zustand projection." | rule-no-any-data: derived step model typed, no any |
| c3-3005 | component | Retired — tuning surface removed from the home screen | c3-3005#n855@v1:sha256:8806259019b9f9337cb77d08279061763b67b18ca1b2fe25acf6d58dd274c291 "Let the user set voice, speed, caption style, and music before voiceover dispatch, and approve the storyboard once all scenes are ready." | Destruction gate: leaf component, no live citers |
| c3-3006 | component | Retired — per-scene preview folded into StepDetail media wells | c3-3006#n880@v1:sha256:e1eed70f2a379591c68804ed251444df7595e56e567517943d2cda12dd3f1eed "Render thumbnails and audio previews for each scene's resolved material and voiceover within TunePanel." | Destruction gate: leaf component, no live citers |
| c3-3007 | component | Retired — approval moved into the gate step detail panel | c3-3007#n904@v1:sha256:cfc57e62f1f28ae17ac53ad7883f7918188c6694532f6c150454016655e186eb "Block or enable the ApproveStoryboard action based on per-scene readiness flags from the Zustand projection." | Destruction gate: leaf component, no live citers |
| c3-30 | container | Membership set changes (−3 retired, +4 new components) | c3-30#n744@v1:sha256:57ab959cf9ca097c002215504af5c233cec19f143361153cb71fc644da91f720 "Be the browser SPA that displays a live project board, dispatches commands to the api, and lets the user tune style parameters and approve the storyboard before" | Membership rows heal automatically from parent links |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-no-any-data | New components and the pipeline model layer type all props/returns with ProjectState/Scene/StepInfo — no any at boundaries | rule-no-any-data#n1006@v1:sha256:5e7bc497997978068e9554409a4ec0fc59c8e2cf481cf0a04a1ee79223d18d95 "All domain and message data must be modeled with concrete named types across every package" | comply |

## Work Breakdown

| Step | Detail |
| --- | --- |
| Pure model | pipeline/derive.ts, eventFormat.ts, media.ts — table-tested (deriveSteps, activeStep, formatEvent, mediaUrl, capUsd, retry map) |
| Store | selectedSteps + inFlight lifecycle (dispatch marks in-flight; result event / RunFailed clears) |
| Components | PipelineNode, StepDetail, EventLog, PipelineCard; Board rewired; old four deleted |
| Styles | pipeline board CSS + switcher keyframes in styles/app.css; retired-component CSS removed |

## Verification

| Check | Result |
| --- | --- |
| cd frontend && bunx tsc --noEmit | clean, no errors |
| cd frontend && bunx oxlint | clean, no warnings |
| cd frontend && bun test | 101 pass / 0 fail (12 files) |
| cd frontend && bunx vite build | built, dist emitted |
| Browser screenshot of seeded board | 6 nodes, flow edges, gate 2px chroma frame, failed retry, color-coded event log render correctly |
