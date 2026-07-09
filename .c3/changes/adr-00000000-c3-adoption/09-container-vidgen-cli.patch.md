---
target: c3-1
scope: whole
type: container
parent: c3-0
title: vidgen CLI process
boundary: Single Go binary; the operator-facing process, invoked from a terminal
---
## Goal

Be the single operator-facing Go process that turns a video idea into a finished 9:16 Vietnamese-voiced short, orchestrating every pipeline step and holding all project state on the local filesystem.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Owns the command surface (cobra), prerequisite resolution, provider selection and secret validation, the resumable project status machine, cost projection/enforcement, and coordination of the media pipeline (script → material → TTS → caption → render → publish). Holds project truth as a JSON manifest under `~/.vidgen/projects/<id>/`. Delegates asynchronous, parallelizable execution to the message-bus container (`c3-2`) but remains the process that starts, embeds, and drives it.
