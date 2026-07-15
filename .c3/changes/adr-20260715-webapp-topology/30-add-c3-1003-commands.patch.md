---
target: c3-1003
scope: whole
type: component
parent: c3-10
title: commands — command handlers and dispatcher
---
## Goal

Implement every user-facing command, enforcing the cost wall and dispatching jobs to the worker via NATS JetStream.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-10 api |
| Category | feature |
| Boundary | In-process module; called by http.ts command router; calls nats.ts and cost.ts |
| Status | active |

## Purpose

Owns createProject, generateScript, tuneProject, resolveMaterial, resolveMaterialWithAssets, generateVoiceovers, requestApproval, approveStoryboard, and publish command functions. The CommandContext DI struct carries EventStore, Publisher, ScriptGenerator, costCapUsd, and mediaDir. Non-goal: does not own HTTP parsing — that is http.ts.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-cost-wall | rule | generateVoiceovers must check admit() before dispatching TTS jobs; cost cap never bypassed | high | Cost wall is the inviolable guard before paid vendor calls |
| rule-no-any-data | rule | CommandContext and all Input types use concrete typed fields | high | No any on command inputs |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| createProject | OUT | Appends ProjectCreated event; returns {projectId} | in-process | api/src/commands.ts |
| generateVoiceovers | OUT | Admits cost via admit(); appends CostProjected; dispatches TTSJob per scene + one CaptionJob | in-process | api/src/commands.ts |
| approveStoryboard | OUT | Refuses if any scene lacks audioDurationSec or materialPath; appends ApprovalGranted; dispatches RenderJob | in-process | api/src/commands.ts |
| tuneProject | OUT | Validates voice/speed/music; appends StyleSet event with uid dedup key | in-process | api/src/commands.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| ApproveStoryboard readiness gate | Contract | N.A - exact gate | api/src/commands.ts |
