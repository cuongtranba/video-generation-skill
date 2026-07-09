---
target: c3-103
scope: whole
type: component
parent: c3-1
category: foundation
title: prereq — external binary resolver
---
## Goal

Resolve and verify the external command-line binaries the pipeline shells out to, before any work starts.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Foundation — run first in `app.init`, gates the whole run |
| Depends on | Go stdlib (`os/exec`); env overrides FFMPEG_BIN/FFPROBE_BIN/WHISPER_BIN/CLAUDE_BIN |
| Consumed by | c3-106 cli (at init), indirectly by render/caption/script |

## Purpose

Owns `Checker` which verifies ffmpeg, ffprobe, whisper, and claude are present and resolves each to an absolute path, honoring per-binary env overrides. Non-goals: does not invoke the tools or interpret their output — only existence and path resolution.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| rule-error-wrap | rule | Missing-prereq errors wrapped and aggregated with op context | Must | one error lists all missing tools |
| rule-di-constructor | rule | `NewChecker()` constructor, no global state | Must | checker holds resolved paths |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `Checker.Check()` | IN | Errors listing every missing prerequisite, or nil | All four tools | internal/prereq/checker.go |
| `Checker.Resolve(name)` | IN | Returns absolute path, honoring the env override | ffmpeg/ffprobe/whisper/claude | internal/prereq/checker.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| prereq tests (faked binaries) | Contract | shell-script fakes in temp dirs | internal/prereq/checker_test.go |
