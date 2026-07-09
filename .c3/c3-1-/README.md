---
id: c3-1
c3-seal: 5fdcecd958e27d39a280a7844362617120745a792441ad3f0e45f5ece7caed3e
title: vidgen CLI process
type: container
parent: c3-0
goal: Be the single operator-facing Go process that turns a video idea into a finished 9:16 Vietnamese-voiced short, orchestrating every pipeline step and holding all project state on the local filesystem.
---

## Goal

Be the single operator-facing Go process that turns a video idea into a finished 9:16 Vietnamese-voiced short, orchestrating every pipeline step and holding all project state on the local filesystem.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-101 | domain — project model & manifest store |  | active | Define the project data model and the persistent, resumable store that every other component reads and writes. |
| c3-102 | config — provider selection & secret validation |  | active | Select which vendor implements each pipeline category and validate that the required secrets exist before any run. |
| c3-103 | prereq — external binary resolver |  | active | Resolve and verify the external command-line binaries the pipeline shells out to, before any work starts. |
| c3-104 | cost — budget estimator & enforced ledger |  | active | Project the USD cost of a video and enforce a hard per-video spending cap at both projection and execution time. |
| c3-105 | videogen — AI clip-generation seam |  | active | Provide a stable interface seam for future AI clip-generation providers so config and wiring have a contract before any implementation exists. |
| c3-106 | cli — cobra command surface & composition root |  | active | Be the composition root: parse commands, resolve prerequisites and config, wire every provider, and dispatch to the flow. |
| c3-110 | flow — pipeline status machine & orchestrator |  | active | Orchestrate the end-to-end project lifecycle as a resumable status machine, enforcing cost gates and coordinating every pipeline step. |
| c3-111 | script — idea to scene script via claude CLI |  | active | Turn a raw video idea into a structured, scene-by-scene Vietnamese narration script. |
| c3-112 | material — stock & local visual sourcing |  | active | Supply each scene with a visual (stock clip/image or local asset) that covers its narration duration. |
| c3-113 | audio-synthesis — TTS voiceover & background music |  | active | Produce the scene voiceover audio and the background music track that together form the video's audio bed. |
| c3-114 | visual-assembly — captions & FFmpeg render |  | active | Turn scene audio and visuals into the finished 9:16 MP4: generate karaoke captions and render the final filtergraph. |
| c3-115 | publish — upload finished video to platform |  | active | Upload the rendered 9:16 MP4 to a destination platform and record the published state. |

## Responsibilities

Owns the command surface (cobra), prerequisite resolution, provider selection and secret validation, the resumable project status machine, cost projection/enforcement, and coordination of the media pipeline (script → material → TTS → caption → render → publish). Holds project truth as a JSON manifest under `~/.vidgen/projects/<id>/`. Delegates asynchronous, parallelizable execution to the message-bus container (`c3-2`) but remains the process that starts, embeds, and drives it.
