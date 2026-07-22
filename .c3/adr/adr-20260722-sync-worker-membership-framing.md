---
id: adr-20260722-sync-worker-membership-framing
c3-seal: 7bea9627070d1d6054b400c6bdfc7e5545af53227c2b69836d8fd73397d35ee7
title: sync-worker-membership-framing
type: adr
goal: Remove the stale "whisper" wording from the c3-20 worker container's membership Goal-Contribution framing for its `caption` (c3-2007) and `prereq` (c3-2009) members, so the frozen parent table matches the just-landed ElevenLabs-timestamp captions decision (adr-20260722-replace-whisper-with-elevenlabs-timestamps).
status: proposed
date: "2026-07-22"
---

## Goal

Remove the stale "whisper" wording from the c3-20 worker container's membership Goal-Contribution framing for its `caption` (c3-2007) and `prereq` (c3-2009) members, so the frozen parent table matches the just-landed ElevenLabs-timestamp captions decision (adr-20260722-replace-whisper-with-elevenlabs-timestamps).

## Context

adr-20260722-replace-whisper-with-elevenlabs-timestamps updated the caption (c3-2007) and prereq (c3-2009) component goals to drop whisper, but the parent c3-20's membership table carries an authored per-child Goal-Contribution snapshot that is not auto-synced from the child goal. Those two rows still read "Transcribe scene voiceovers with whisper" and "ffmpeg, ffprobe, and whisper binaries ... WHISPER_BIN" — frozen residue contradicting the applied decision. This is the parent-delta that should have ridden in the original unit.

## Decision

Author two `block` patches on the c3-20 Components membership rows (c3-2007, c3-2009), rewriting only the Goal-Contribution cell to the whisper-free framing that matches each child's new goal. No child re-parenting, no row add/remove — only the framing text of existing rows changes. (Out of scope: the c3-2003 row's pre-existing "FPT.AI async-polling" residue, left by the earlier FPT-removal ADR — unrelated to whisper.)

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-20 | container | membership Goal-Contribution framing for c3-2007 and c3-2009 still names whisper after the transcriber swap | c3-20#n1127@v2:sha256:df4cd93931a2c5849b26d1a014060b5077f60aa125291707800e1282bf9b4be3 "Be the Go process that consumes VIDGEN_JOBS from NATS JetStream and executes material resolution, TTS synthesis, caption generation, and video rendering idempot" | none — free-text framing sync only, no contract/governance change |

## Verification

| Check | Result |
| --- | --- |
| c3 check after apply | expected ok:true |
| c3 read c3-20 --section Components shows no "whisper" in the c3-2007 / c3-2009 rows | expected zero whisper hits in those two rows |
