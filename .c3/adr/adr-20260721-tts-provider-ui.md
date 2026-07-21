---
id: adr-20260721-tts-provider-ui
c3-seal: 13aae727316390eab7c47763c03212f371f5f1397cd3dc4d001556a4613ba9c3
title: tts-provider-ui
type: adr
goal: Expose the active TTS provider from the api so the frontend TunePanel disables the Voice picker and Speed slider (and shows an explanatory note) when the selected provider is ElevenLabs, whose synthesis ignores both fields. Add a read-only `GET /api/config` endpoint returning `{ ttsProvider }`, sourced from `config.yaml`, and consume it in the Zustand store.
status: accepted
date: "2026-07-21"
---

## Goal

Expose the active TTS provider from the api so the frontend TunePanel disables the Voice picker and Speed slider (and shows an explanatory note) when the selected provider is ElevenLabs, whose synthesis ignores both fields. Add a read-only `GET /api/config` endpoint returning `{ ttsProvider }`, sourced from `config.yaml`, and consume it in the Zustand store.

## Context

`config.yaml` selects the TTS provider and is mounted only into the worker (c3-20 / c3-2008). Under `tts.provider: elevenlabs` the worker's ElevenLabs provider hardcodes a fixed voice ID and applies no speed (worker/internal/tts/elevenlabs.go: "req.Voice/req.Speed accepted for interface parity but not applied"). But the frontend TunePanel (c3-3005) still renders the FPT voice dropdown and a Speed slider, so users pick controls that have zero effect on output — misleading, not a synthesis bug. Neither the api (c3-10) nor the frontend (c3-30) currently knows the active provider. The fix keeps `config.yaml` the single source of truth and adds a thin read path to the SPA.

## Decision

The api reads the active TTS provider from `config.yaml` at startup (via built-in `Bun.YAML.parse`, no new dependency) and serves it on a new read endpoint `GET /api/config` → `{ ttsProvider }`. `config.yaml` is additionally mounted read-only into the api container (`CONFIG_PATH` env). The store (c3-3001) gains a `fetchConfig` action that GETs `/api/config` on bootstrap and stores `ttsProvider` in Zustand shared state (not component-local — ESLint-banned). TunePanel (c3-3005) reads `ttsProvider` and, when `elevenlabs`, disables the Voice select + Speed range and renders a lock note. Falls back to `fpt` (controls active) if config is unreadable, so the UI never falsely disables. Provider selection stays in `config.yaml`; the worker, cost wall, and event catalogue are untouched.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-1008 | component | Adds GET /api/config ttsProvider read endpoint and loads provider from config.yaml | c3-1008#n377@v1:sha256:c5bddd95c931729f845a19d5fa4c78f8819fdef80d733f30c2243182e473c6d9 "GET /api/state" | rule-no-any-data: TtsProvider is a concrete union, no any on parsed config |
| c3-3001 | component | Adds fetchConfig action + ttsProvider store state consumed by components | c3-3001#n712@v1:sha256:c7f8be912ac42872223a259fcc50df73d205d93698cc6f8e232c9a8ff2dd1500 "dispatchCommand" | rule-no-any-data: TtsProvider union typed in store |
| c3-3005 | component | Reads store.ttsProvider to disable Voice + Speed controls under elevenlabs | c3-3005#n807@v1:sha256:8a9fcd7b9036f8528aafde0863f0ab6aa41fdb6463f61dc43b1db6a138b45b63 "TunePanel.onTune" | rule-no-any-data: provider-gated rendering uses typed store selector |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-no-any-data | New TtsProvider type crosses api parse boundary and store state; must be a concrete union, not any/unknown | rule-no-any-data#n940@v1:sha256:5e7bc497997978068e9554409a4ec0fc59c8e2cf481cf0a04a1ee79223d18d95 "All domain and message data must be modeled with concrete named types" | comply |

## Verification

| Check | Result |
| --- | --- |
| cd api && bun test && bun run typecheck | green; config.test.ts covers parseTtsProvider (elevenlabs/fpt/missing/garbage) |
| cd frontend && bun test | green; TunePanel disables voice+speed and shows lock note when ttsProvider=elevenlabs |
| curl -s localhost:8080/api/config | returns {"ttsProvider":"elevenlabs"} with config.yaml mounted into api |
| Flip config.yaml tts.provider to fpt, recreate api, curl /api/config | returns {"ttsProvider":"fpt"}; TunePanel voice+speed re-enabled |
