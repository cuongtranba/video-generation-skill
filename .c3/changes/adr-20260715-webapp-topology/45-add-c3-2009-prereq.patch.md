---
target: c3-2009
scope: whole
type: component
parent: c3-20
title: prereq — external binary resolver
---
## Goal

Resolve and verify ffmpeg, ffprobe, and whisper binaries at worker startup, honoring env overrides.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | foundation |
| Boundary | In-process Go; called once at startup before any job consumption |
| Status | active |

## Purpose

Owns binary resolution via FFMPEG_BIN, FFPROBE_BIN, WHISPER_BIN env overrides (falling back to PATH). Fails fast with a clear error if a required binary is missing. Non-goal: does not resolve the claude binary (the old CLI had this; the webapp worker does not use claude CLI).

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-error-wrap | rule | Binary-not-found errors wrapped | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Resolve | OUT | Returns resolved binary paths for ffmpeg, ffprobe, whisper; errors if any missing | in-process | worker/internal/prereq/ |

| BinaryPaths | OUT | Returns struct with resolved paths for ffmpeg, ffprobe, whisper | in-process | worker/internal/prereq/ |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| FFMPEG_BIN/FFPROBE_BIN/WHISPER_BIN | Contract | N.A - must check env first | CLAUDE.md External binaries |
