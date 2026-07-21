---
id: adr-20260721-fpt-doc-residue
c3-seal: 37afa62f86e8e51fb3a4ca57aeb99980c6ceb0061dfb0a490f53fff3bfa59e82
title: fpt-doc-residue
type: adr
goal: 'Remove the last FPT.AI mentions from three frozen facts whose prose still names FPT as the TTS / paid-vendor example, now that ElevenLabs is the only TTS provider: the c3-0 system goal pipeline sentence, ref-idempotent-worker''s rationale, and rule-tdd-table-tests'' anti-pattern row.'
status: accepted
date: "2026-07-21"
---

## Goal

Remove the last FPT.AI mentions from three frozen facts whose prose still names FPT as the TTS / paid-vendor example, now that ElevenLabs is the only TTS provider: the c3-0 system goal pipeline sentence, ref-idempotent-worker's rationale, and rule-tdd-table-tests' anti-pattern row.

## Context

The FPT.AI provider was removed (ADR adr-20260721-remove-fpt-tts) across code and the facts describing that code. Three facts still carry FPT in illustrative prose: c3-0's goal names "FPT.AI TTS" in the pipeline, ref-idempotent-worker cites "per-character FPT.AI billing" as the paid step, and rule-tdd-table-tests uses "the real FPT.AI / Pexels endpoint" as the don't-hit-live example. These are stale — ElevenLabs is now the paid TTS line.

## Decision

Replace "FPT.AI" with "ElevenLabs" (or a neutral "TTS") in each of the three nodes, leaving all other wording intact. No code change; documentation truth only.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Goal pipeline sentence names FPT.AI TTS | c3-0#n2@v1:sha256:5ca831a39e8df95283d2e1b878e5b9920429b33eed31855df5f0c9b51f63a151 "idea → script → stock material" | N.A - doc-truth only |
| ref-idempotent-worker | ref | Rationale names per-character FPT.AI billing as the paid step | ref-idempotent-worker#n866@v1:sha256:8d6daa8062bf0a1385ad5a7fd5ca47c3f6c87fe0bd03460d3b342a65bac635b4 "TTS is the only paid step" | N.A - doc-truth only |
| rule-tdd-table-tests | rule | Anti-pattern row names the real FPT.AI endpoint | rule-tdd-table-tests#n964@v1:sha256:376252dfcdfed6a9252cb3ccb7c027da8ee16e082de86ef14a79a7db8e13a4fe "Hitting the real" | N.A - doc-truth only |

## Verification

| Check | Result |
| --- | --- |
| c3x read c3-0 --section Goal | names ElevenLabs TTS, not FPT.AI |
| c3x check | clean |
| rg -i fpt (excluding .c3/changes, docs/superpowers) | only the removal ADRs (which are about FPT) mention it |
