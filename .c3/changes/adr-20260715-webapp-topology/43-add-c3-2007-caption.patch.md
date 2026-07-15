---
target: c3-2007
scope: whole
type: component
parent: c3-20
title: caption — Whisper caption transcription and ASS generation
---
## Goal

Transcribe scene voiceovers with whisper and emit a project-level ASS subtitle file for the render.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | feature |
| Boundary | In-process Go; shells out to whisper binary resolved by prereq/ |
| Status | active |

## Purpose

Owns whisper invocation with -language vi, word-timestamp parsing, karaoke caption line splitting (>0.8s gap = new line), and ASS file generation. One ASS file per project (not per scene). Non-goal: does not own audio synthesis — that is tts/.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-error-wrap | rule | whisper subprocess errors wrapped | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| CaptionHandler | OUT | Accepts CaptionJob (sceneAudio refs + style); writes captions.ass; publishes CaptionsBuilt | in-process | worker/internal/caption/ |
| CaptionsBuilt.SceneIdx | OUT | Always 0 — one ASS file per project, per plan decision #6 | NATS event | worker/internal/eventstore/events.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| whisper -language vi | Contract | N.A - lang must be vi | CLAUDE.md Gotchas |
