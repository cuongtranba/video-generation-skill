---
target: ref-idempotent-worker
scope: whole
type: ref
title: Output-exists idempotency for re-runnable workers
---
## Goal

Re-running generation after a crash, partial failure, or JetStream redelivery must never repeat expensive or paid work. The pattern standardizes how every worker decides whether its job is already done.

## Choice

Each worker computes its deterministic output path and, before doing any work, checks whether that file already exists; if it does, the worker returns the existing artifact and skips. Jobs are keyed by `(project, scene, kind)` so redelivery of the same job is a no-op.

## Why

TTS is the only paid step (per-character FPT.AI billing) and renders are slow; NATS JetStream may redeliver a message, and users re-run `generate` freely on the same project. An output-exists guard makes any re-run cost `$0` and semantically idempotent, instead of re-charging the vendor or re-rendering. The alternative — tracking completion in external state — was rejected because the artifact file itself is the ground truth already co-located with the project.

## How

Golden pattern — resolve the destination path, stat it, and short-circuit before the vendor/subprocess call (REQUIRED: existence check precedes work; the existing file is returned as the result). Source: `internal/worker/worker.go`.

```go
// before invoking the paid/slow operation:
if _, err := os.Stat(job.DestPath); err == nil {
	// already produced by a prior run — skip and reuse
	return existingResult(job), nil
}
```
