---
target: c3-304
scope: whole
type: component
parent: c3-3
category: foundation
title: script — idea to scene script via Claude Agent SDK
---
## Goal

Turn a raw video idea into a structured, scene-by-scene Vietnamese narration script using the Claude Agent SDK, replacing the old claude CLI subprocess.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-3 api |
| Layer | Feature — first pipeline step, produces the scenes everything else consumes |
| Depends on | @anthropic-ai/claude-agent-sdk (query, options.outputFormat = json_schema) |
| Consumed by | c3-302 commands-http (GenerateScript) |

## Purpose

Owns the Agent SDK call (idea → scenes), reading message.structured_output + message.total_cost_usd on message.type === 'result', and always recording ScriptGenerated.scriptUsd = 0 regardless of the SDK's notional cost figure (index §6, binding). Non-goals: no rendering, no TTS — text only.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-cost-wall | rule | Never lets Agent SDK notional cost enter the enforced total | Authoritative | scriptUsd hardcoded 0 |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| generateScript(idea, opts) | IN/OUT | Produces ordered Scene[] with Vietnamese narration via Agent SDK | Runs on Claude subscription (free to project cost) | api/src/script.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| script generation tests | Contract | mocked/recorded Agent SDK responses | api/src/script.test.ts |
