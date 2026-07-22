---
id: adr-20260722-replace-whisper-with-elevenlabs-timestamps
c3-seal: cce3b8b230dcbbe3c0da1737123b2f849dd74bb971031be755d8f08bfa077487
title: replace-whisper-with-elevenlabs-timestamps
type: adr
goal: Replace the worker's whisper-CLI caption transcription with word timestamps returned by ElevenLabs' `/v1/text-to-speech/{voice}/with-timestamps` synthesis endpoint, persisted as per-scene `tts{idx}.words.json` sidecars. The `caption` component no longer shells out to whisper; the `tts` component now emits the sidecars alongside each mp3; the `prereq` component no longer resolves a whisper binary.
status: accepted
date: "2026-07-22"
---

## Goal

Replace the worker's whisper-CLI caption transcription with word timestamps returned by ElevenLabs' `/v1/text-to-speech/{voice}/with-timestamps` synthesis endpoint, persisted as per-scene `tts{idx}.words.json` sidecars. The `caption` component no longer shells out to whisper; the `tts` component now emits the sidecars alongside each mp3; the `prereq` component no longer resolves a whisper binary.

## Context

The `caption` component (c3-2007) ran the openai-whisper CLI over each scene's TTS mp3 to recover word-level timestamps for the karaoke ASS file — 2–6 minutes of CPU-bound work per project (~660% CPU in production) gating `captionsReady`, plus a ~1–2 GB whisper layer in the worker image and a startup dependency on a `whisper` binary. ElevenLabs already computes word timing when it synthesizes the audio and returns it, at no extra billing, from the `/with-timestamps` endpoint. Affected topology: worker container c3-20 — components `tts` (c3-2003, now the timing source), `caption` (c3-2007, now a sidecar reader), and `prereq` (c3-2009, whisper requirement removed).

## Decision

Use approach A (synthesize-with-timestamps + sidecar): the `tts` component calls `/with-timestamps`, decodes `audio_base64` to the mp3 (unchanged path), converts the character-level alignment to word timestamps, and writes a `tts{idx}.words.json` sidecar next to the mp3 (atomic temp+rename), via the shared `caption.WordsSidecarPath` convention. The `caption` component reads those sidecars through a new `caption.SidecarReader` that satisfies the unchanged `Transcriber` interface — the caption handler, the `CaptionJob`/`CaptionsBuilt` job/event catalogue, and the ASS writer are untouched. Whisper is deleted entirely (code, tests, prereq requirement, `WHISPER_BIN`, and the Docker install). A missing sidecar makes the caption job fail loudly (RunFailed) rather than fabricate timings. Rejected: forced-alignment API (extra billed call per scene) and removing the caption stage (frozen-catalogue churn).

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2003 | component | tts now calls /with-timestamps and writes the tts{idx}.words.json word-timestamp sidecar alongside the mp3 | c3-2003#n588@v1:sha256:7ca7432481777eb9e935770e891df69b12e7db5cc43591f20b2a34aadc35afee "Owns the TTSProvider interface, ElevenLabsProvider (synchronous POST returning mp3 bytes; fixed voice ID), and the NewFromConfig factory. ElevenLabs is the only" | rule-error-wrap on sidecar/base64 errors; ref-provider-seam unchanged (still a TTSProvider) |
| c3-2007 | component | caption no longer invokes whisper; reads sidecars via SidecarReader behind the unchanged Transcriber interface | c3-2007#n681@v1:sha256:5e9b3b5a24a4427d6af9ed73b79c6ab81d1d3e2525781b9b2ebf6718f2be5ebf "Transcribe scene voiceovers with whisper and emit a project-level ASS subtitle file for the render." | rule-error-wrap on sidecar read errors; CaptionsBuilt contract unchanged |
| c3-2009 | component | prereq no longer resolves/requires a whisper binary at startup | c3-2009#n730@v1:sha256:d6a7d26c719545ef7ccd3565bdab8c8f8551d0491ff38c4da78cf4c653130f6f "Resolve and verify ffmpeg, ffprobe, and whisper binaries at worker startup, honoring env overrides." | rule-error-wrap unchanged; only the whisper requirement is dropped |

## Verification

| Check | Result |
| --- | --- |
| cd worker && go build ./... && go vet ./... && go test ./internal/tts/... ./internal/caption/... ./internal/jobhandler/... ./internal/prereq/... ./internal/render/... | all green (commits a6122ec, 6b4faa7, 3020a29, 48d374e, 7cd6f09) |
| grep -rn -i whisper worker/ --include='*.go' | zero hits (whisper fully removed) |
| Live deploy golden path: create -> script -> material -> GenerateVoiceovers, observe captionsReady then render | pending deploy; captionsReady expected within seconds of last VoiceSynthesized, RenderCompleted with burned captions |
