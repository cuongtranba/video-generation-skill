---
target: c3-114
scope: whole
type: component
parent: c3-1
category: feature
title: visual-assembly — captions & FFmpeg render
---
## Goal

Turn scene audio and visuals into the finished 9:16 MP4: generate karaoke captions and render the final filtergraph.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Feature — groups the two assembly categories (caption, render), last before publish |
| Depends on | c3-103 prereq (whisper/ffmpeg/ffprobe), c3-113 audio-synthesis, c3-112 material |
| Consumed by | c3-110 flow, c3-210 worker (CaptionJob, RenderJob) |

## Purpose

Groups `internal/caption` and `internal/render`: caption runs whisper for VN word timestamps and emits an `.ass` file (lines split on >0.8s word gaps or karaoke desync), render builds the FFmpeg filtergraph (zoompan for images entering as a single frame, `-stream_loop` for short clips, `ass=` subtitle overlay, music mux) into a 9:16 MP4. Non-goals: no audio synthesis, no upload.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-di-constructor | rule | `var _ Renderer = (*FFmpegRenderer)(nil)`; injected binary paths | Must | compile-time seam check |
| rule-error-wrap | rule | whisper/ffmpeg subprocess errors wrapped with op context | Must | wraps exec failures |
| rule-tdd-table-tests | rule | Filtergraph + caption splitting covered by table tests | Must | ass_test, filtergraph_test |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `Transcriber` → `.ass` | IN/OUT | Whisper word timestamps → caption lines split on gaps/desync | Requires whisper (libass ffmpeg) | internal/caption/whisper.go |
| `Renderer.Render(...)` | IN/OUT | Composes scenes+captions+music into a 9:16 MP4 filtergraph | Requires ffmpeg w/ subtitle filters | internal/render/renderer.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| caption/render tests | Contract | integration render behind build tag | internal/render/filtergraph_test.go |
