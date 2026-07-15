---
target: c3-20
scope: whole
type: container
parent: c3-0
title: worker — Go idempotent job consumers
---
## Goal

Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempotently, publishing result events back to VIDGEN_EVENTS.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-2001 | jobhandler — material, tts, caption, render handlers | feature | active | Implement the four job handler types (MaterialJob, TTSJob, CaptionJob, RenderJob) with output-exists idempotency and publish result events. |
| c3-2002 | eventstore — result event structs and publisher | foundation | active | Define the worker-side result event structs (MaterialResolved, VoiceSynthesized, CaptionsBuilt, RenderCompleted, RunFailed) mirroring api/src/events.ts, and publish them to VIDGEN_EVENTS. |
| c3-2003 | tts — FPT.AI and ElevenLabs TTS providers with factory | feature | active | Provide FPT.AI async-polling TTS and ElevenLabs TTS behind a TTSProvider interface; NewFromConfig selects the implementation from config.yaml. |
| c3-2004 | material — stock visual sourcing (Pexels/Pixabay) | feature | active | Resolve and download scene visual stock from Pexels or Pixabay to the shared media volume. |
| c3-2005 | music — Jamendo background music sourcing | feature | active | Search and download background music from Jamendo by keyword for the render job. |
| c3-2006 | render — FFmpeg filtergraph video renderer | feature | active | Compose the final 9:16 MP4 using FFmpeg: per-scene zoompan/loop video, TTS audio, libass captions, and optional music mix. |
| c3-2007 | caption — Whisper caption transcription and ASS generation | feature | active | Transcribe scene voiceovers with whisper and emit a project-level ASS subtitle file for the render. |
| c3-2008 | config — provider selection and secret loading | foundation | active | Load config.yaml (provider selection) and .env (secrets); validate that required secrets exist for the selected providers. |
| c3-2009 | prereq — external binary resolver | foundation | active | Resolve and verify ffmpeg, ffprobe, and whisper binaries at startup, honoring FFMPEG_BIN/FFPROBE_BIN/WHISPER_BIN env overrides. |
| c3-2010 | domain — shared domain types (Voice, Speed, CaptionStyle) | foundation | active | Define the domain value types shared across job handler, TTS, and config packages. |

## Responsibilities

Owns all job execution: material download, TTS synthesis, whisper captioning, FFmpeg rendering. Does not own the event store (VIDGEN_EVENTS is api's stream; worker only appends result events) or the cost wall (enforced by api before job dispatch). Idempotency is the worker's responsibility: every handler checks output-file existence before any paid or slow operation.
