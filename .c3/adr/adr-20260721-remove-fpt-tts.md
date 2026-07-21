---
id: adr-20260721-remove-fpt-tts
c3-seal: 3147f604ae41805061454495f7499c86f86e94adaa744f52bff0d5ec31d7f5f0
title: remove-fpt-tts
type: adr
goal: Remove the FPT.AI TTS provider entirely, leaving ElevenLabs as the only TTS provider, and drop the now-pointless voice/speed picker from the SPA (replaced by a read-only "ElevenLabs (fixed)" label). Bring the frozen architecture facts that still describe FPT — the deleted `FPTAIProvider`, the `FPT_TTS_USD_PER_CHAR` constant, the `fpt` factory case, and the provider-gating UI — back in line with the code.
status: accepted
date: "2026-07-21"
---

## Goal

Remove the FPT.AI TTS provider entirely, leaving ElevenLabs as the only TTS provider, and drop the now-pointless voice/speed picker from the SPA (replaced by a read-only "ElevenLabs (fixed)" label). Bring the frozen architecture facts that still describe FPT — the deleted `FPTAIProvider`, the `FPT_TTS_USD_PER_CHAR` constant, the `fpt` factory case, and the provider-gating UI — back in line with the code.

## Context

FPT.AI was a second TTS provider (async-polling `FPTAIProvider` in `worker/internal/tts/provider.go`, an `fpt` case in the factory + config validation, and an FPT-named cost constant). It is 429-rate-limited on the free tier and its voice names never applied under ElevenLabs, which uses a fixed voice ID. The code for FPT has been deleted across worker (Go), api (TS), frontend, config.yaml, and docs; the cost constant was renamed provider-neutrally (`TTS_USD_PER_CHAR`, same value). Several frozen facts still name FPT and now describe code that no longer exists: c3-2003 (tts), c3-1006 (cost), c3-1008 (my GET /api/config row), c3-3005 (my TunePanel row), and ref-provider-seam (the factory code example).

## Decision

Update every affected fact to describe the ElevenLabs-only reality: c3-2003 drops all FPTAIProvider/async-polling language; c3-1006 renames the cost surface to `TTS_USD_PER_CHAR`; ref-provider-seam's factory example drops the `fpt` case; c3-1008's config-read row notes an `elevenlabs` fallback; c3-3005's row reflects the read-only fixed-voice label (picker removed). The Voice/Speed domain types stay in the event model (frozen catalogue) — only the provider, its config/pricing name, and the UI picker are removed. Cost-wall value is unchanged (rename only).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2003 | component | Describes deleted FPTAIProvider + async-polling; now ElevenLabs-only | c3-2003#n481@v1:sha256:4ad974ba1b8ffae15f5b88a12131ae615a03cfd5661c211914ec4ca05eaf9980 "Provide FPT.AI async-polling TTS" | ref-provider-seam still governs the single-switch factory |
| c3-1006 | component | FPT_TTS_USD_PER_CHAR renamed to TTS_USD_PER_CHAR (cost-wall value unchanged) | c3-1006#n318@v1:sha256:ebca294141a64dbcb4082a4fc87d8c7bc27da881823bc3129e64c0d4efa3570c "Owns projectedTtsUsd" | rule-cost-wall: value preserved, only renamed |
| c3-1008 | component | GET /api/config fallback provider is now elevenlabs, not fpt | c3-1008#n988@v1:sha256:b4ce7132736854829ad941967df83541ff0fba6a7cca277756c6b14cb425354f "GET /api/config" | N.A - doc-truth only |
| c3-3005 | component | Voice/Speed picker removed; TunePanel shows a fixed ElevenLabs label | c3-3005#n990@v1:sha256:32f0c5dbcb1d698e60528c1c5b5e203a68881e9e82199b51f76365846b7e6709 "TunePanel.voiceLock" | N.A - doc-truth only |
| ref-provider-seam | ref | Factory code example still shows the deleted fpt case / NewFPTAIProvider | ref-provider-seam#n879@v1:sha256:ad3f528a877cb686ed384b705e33123f4207254b1fb579ee4ce22607ddb1d8cd "func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {" | ref stays authoritative for the seam pattern |

## Verification

| Check | Result |
| --- | --- |
| cd worker && go build ./... && go vet ./internal/tts/... ./internal/config/... ./internal/jobhandler/... | clean; no fpt symbols |
| cd worker && go test ./internal/tts/... ./internal/config/... ./internal/jobhandler/... | green |
| cd api && bun test && bun run typecheck | green; parseTtsProvider falls back to elevenlabs |
| cd frontend && bunx tsc --noEmit && bun test && bun run lint | green; TunePanel shows tune-voice-fixed, no voice combobox/speed slider |
| rg -i fpt worker api frontend config.yaml README.md CLAUDE.md docs | only historical .c3/changes/** references remain |
