---
target: c3-1007
scope: whole
type: component
parent: c3-10
title: script — Agent SDK scene generator
---
## Goal

Use the Anthropic Agent SDK to turn a video idea into a structured scene list, satisfying the ScriptGenerator interface that command handlers depend on.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-10 api |
| Category | feature |
| Boundary | In-process module; calls external Anthropic Agent SDK API; requires CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY |
| Status | active |

## Purpose

Owns sdkScriptGenerator (the real production adapter), stubScriptGenerator (deterministic offline test adapter), generateScenes (SDK query loop), buildScriptPrompt (Vietnamese-language prompt), and parseScenes (schema-validated output parser). scriptUsd is always 0 in ScriptGenerated events — notional Agent SDK cost is logged only, never enforced. Non-goal: does not own cost enforcement — the cost wall covers TTS only.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | parseScenes validates structured_output shape before returning Scene[]; no any cast | high | Explicit validation before typing |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| ScriptGenerator interface | IN/OUT | generateScenes(idea, durationSec, sceneCount, tone) → {scenes: Scene[]} | in-process seam | api/src/commands.ts |
| sdkScriptGenerator | OUT | Calls @anthropic-ai/claude-agent-sdk query(); logs notionalUsd; returns scenes only | external API call | api/src/script.ts |
| scriptUsd on ScriptGenerated | OUT | Always 0 — Agent SDK notional cost is never billed or enforced | NATS event payload | api/src/script.ts line 98 |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| buildScriptPrompt | Contract | Prompt text may evolve; sceneCount constraint must not be removed | api/src/script.ts |
