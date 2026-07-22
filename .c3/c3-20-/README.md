---
id: c3-20
c3-seal: 8e64634c6edacbfa6421a8c1efed1c5cdcaf6d6f7b855992a9dde902e90017af
title: worker — Go idempotent job consumers
type: container
parent: c3-0
goal: Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempotently, publishing result events back to VIDGEN_EVENTS.
---

## Goal

Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempotently, publishing result events back to VIDGEN_EVENTS.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-2001 | jobhandler — material, tts, caption, render handlers |  | active | Implement the four job handler types (MaterialJob, TTSJob, CaptionJob, RenderJob) with output-exists idempotency and publish result events. |
| c3-2002 | eventstore — result event structs and publisher |  | active | Define the worker-side result event structs (MaterialResolved, VoiceSynthesized, CaptionsBuilt, RenderCompleted, RunFailed) mirroring api/src/events.ts, and publish them to VIDGEN_EVENTS. |
| c3-2003 | tts — ElevenLabs TTS provider with factory |  | active | Provide FPT.AI async-polling TTS and ElevenLabs TTS behind a TTSProvider interface; NewFromConfig selects the implementation from config.yaml. |
| c3-2004 | material — stock visual sourcing (Pexels/Pixabay) |  | active | Resolve and download scene visual stock from Pexels or Pixabay to the shared media volume. |
| c3-2005 | music — Jamendo background music sourcing |  | active | Search and download background music from Jamendo by keyword for the render job. |
| c3-2006 | render — FFmpeg filtergraph video renderer |  | active | Compose the final 9:16 MP4 using FFmpeg: per-scene zoompan/loop video, TTS audio, libass captions, and optional music mix. |
| c3-2007 | caption — ElevenLabs-timestamp captions and ASS generation |  | active | Turn scene voiceovers into a project-level ASS subtitle file for the render, using word timestamps captured from ElevenLabs synthesis. |
| c3-2008 | config — provider selection and secret loading |  | active | Load config.yaml (provider selection) and .env (secrets); validate that required secrets exist for the selected providers. |
| c3-2009 | prereq — external binary resolver |  | active | Resolve and verify ffmpeg and ffprobe binaries at startup, honoring FFMPEG_BIN/FFPROBE_BIN env overrides. |
| c3-2010 | domain — shared domain types (Voice, Speed, CaptionStyle) |  | active | Define the domain value types shared across job handler, TTS, and config packages. |

## Responsibilities

Owns all job execution: material download, TTS synthesis (with word-timestamp sidecars), caption ASS generation, FFmpeg rendering. Does not own the event store (VIDGEN_EVENTS is api's stream; worker only appends result events) or the cost wall (enforced by api before job dispatch). Idempotency is the worker's responsibility: every handler checks output-file existence before any paid or slow operation.
