---
id: c3-0
c3-seal: c6799b056b45c63e8fb0294a5ac4b7d9e5631fcd58bb55ff0c3c8d088f275e00
title: video-generation-skill
goal: Turn a single video idea into a finished, publish-ready 9:16 Vietnamese-voiced short — idea → script → stock material → FPT.AI TTS → whisper captions → FFmpeg render → platform upload — as one resumable, cost-capped local CLI pipeline.
---

## Goal

Turn a single video idea into a finished, publish-ready 9:16 Vietnamese-voiced short — idea → script → stock material → FPT.AI TTS → whisper captions → FFmpeg render → platform upload — as one resumable, cost-capped local CLI pipeline.

## Containers

| ID | Name | Boundary | Status | Responsibilities | Goal Contribution |
| --- | --- | --- | --- | --- | --- |
| c3-1 | vidgen CLI process |  | active | Be the single operator-facing Go process that turns a video idea into a finished 9:16 Vietnamese-voiced short, orchestrating every pipeline step and holding all project state on the local filesystem. | Be the single operator-facing Go process that turns a video idea into a finished 9:16 Vietnamese-voiced short, orchestrating every pipeline step and holding all project state on the local filesystem. |
| c3-2 | Message bus / async execution plane |  | active | Be the asynchronous execution plane that fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — decoupling job submission from job completion during generate. | Be the asynchronous execution plane that fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — decoupling job submission from job completion during generate. |

## Abstract Constraints

| Constraint | Rationale | Affected Containers |
| --- | --- | --- |
| Hard per-video cost cap ($0.10), enforced at projection and execution | Prevents any run from overspending on paid vendor calls (FPT.AI TTS is the only paid line) | c3-1 |
| All project state is a resumable JSON manifest co-located with assets | Long, failure-prone, multi-vendor pipeline must survive crashes and resume every step | c3-1 |
| Every external vendor sits behind a config-selected factory + interface seam | Vendors churn; swapping or adding one must not touch pipeline callers, and secrets stay in .env | c3-1 |
| Asynchronous work is idempotent: output-exists check before any paid/slow op | Re-runs and JetStream redelivery must cost $0 and never duplicate artifacts | c3-2 |
| External binaries (ffmpeg/ffprobe/whisper/claude) resolved and verified up front | Fail fast with a clear message rather than mid-render, honoring env overrides | c3-1 |
