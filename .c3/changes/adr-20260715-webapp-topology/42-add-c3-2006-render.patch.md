---
target: c3-2006
scope: whole
type: component
parent: c3-20
title: render — FFmpeg filtergraph video renderer
---
## Goal

Compose the final 9:16 MP4 using FFmpeg: per-scene zoompan/loop video, TTS audio, libass captions, and optional music mix.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | feature |
| Boundary | In-process Go; shells out to ffmpeg binary resolved by prereq/ |
| Status | active |

## Purpose

Owns FilterGraph construction, zoompan for still images, stream_loop for short clips, libass caption overlay (requires Homebrew-FFmpeg tap for libass support), and optional music mix. Non-goal: does not own caption generation — that is caption/; does not fetch music — that is music/.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-di-constructor | rule | Renderer interface with var _ Renderer = (*FFmpegRenderer)(nil) | high | N.A - no additional notes |
| rule-error-wrap | rule | ffmpeg subprocess errors wrapped | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Renderer.Render | OUT | Accepts RenderJob scenes + assPath + optional music; writes to OutputPath; returns renderUsd (notional) | in-process | worker/internal/render/ |
| libass requirement | OUT | ffmpeg must have libass filter; use homebrew-ffmpeg/ffmpeg/ffmpeg tap | build-time | CLAUDE.md Gotchas section |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| zoompan for images | Contract | N.A - zoompan multiplies frames | CLAUDE.md Gotchas |
