---
target: c3-113
scope: whole
type: component
parent: c3-1
category: feature
title: audio-synthesis — TTS voiceover & background music
---
## Goal

Produce the scene voiceover audio and the background music track that together form the video's audio bed.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Feature — groups the two audio-producing pipeline categories (tts, music) |
| Depends on | c3-102 config, c3-104 cost (TTS is the paid line), FPT.AI + Jamendo HTTP APIs |
| Consumed by | c3-110 flow, c3-210 worker (TTSJob), c3-114 visual-assembly (mux) |

## Purpose

Groups the `internal/tts` and `internal/music` packages: `TTSProvider` (FPT.AI async synth — submit, poll the returned mp3 URL until HTTP 200) with a `DurationProbe`, and `MusicSource` (Jamendo search, since Pixabay has no music API). Both selected via `NewFromConfig`. Non-goals: no captioning, no video render.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| ref-provider-seam | ref | Both tts and music built via their `NewFromConfig` factory | Authoritative | fpt / jamendo selectable |
| rule-cost-wall | rule | TTS is the only paid line; chars charged feed the ledger | Authoritative | per-char FPT.AI billing |
| rule-di-constructor | rule | `var _ TTSProvider = (*FPTAIProvider)(nil)`, `var _ MusicSource` | Must | compile-time seam checks |
| rule-error-wrap | rule | Poll/HTTP errors wrapped with op context | Must | async poll wrap |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `TTSProvider.Synthesize(...)` | IN/OUT | Async: returns mp3 URL, polls until ready (5s–2min); reports chars charged | Paid per character | internal/tts/provider.go |
| `MusicSource.Search(ctx, mood)` | IN/OUT | Returns a Jamendo track URL for background music | Requires JAMENDO_CLIENT_ID | internal/music/jamendo.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| tts/music tests | Contract | httptest-stubbed vendors | internal/tts/provider_test.go |
