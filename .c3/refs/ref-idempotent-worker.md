---
id: ref-idempotent-worker
c3-seal: 08a43b13afa51a5062b6965f7f4499574f6da51dfa0612680c0a56d7878bb332
title: Output-exists idempotency for re-runnable workers
type: ref
goal: Re-running generation after a crash, partial failure, or JetStream redelivery must never repeat expensive or paid work. The pattern standardizes how every worker decides whether its job is already done.
---

## Goal

Re-running generation after a crash, partial failure, or JetStream redelivery must never repeat expensive or paid work. The pattern standardizes how every worker decides whether its job is already done.

## Choice

Each worker computes its deterministic output path and, before doing any work, checks whether that file already exists; if it does, the worker returns the existing artifact and skips. Jobs are keyed by `(project, scene, kind)` so redelivery of the same job is a no-op.

## Why

TTS is the only paid step (per-character ElevenLabs billing) and renders are slow; NATS JetStream may redeliver a message, and users re-run `generate` freely on the same project. An output-exists guard makes any re-run cost `$0` and semantically idempotent, instead of re-charging the vendor or re-rendering. The alternative — tracking completion in external state — was rejected because the artifact file itself is the ground truth already co-located with the project.

## How

Golden pattern — resolve the destination path, stat it, and short-circuit before the vendor/subprocess call (REQUIRED: existence check precedes work; the existing path is returned as the cached result). Source: `worker/internal/jobhandler/material.go`.

```go
// cheap short-circuit: msgID dedup at publish time is the correctness
// boundary, this just avoids redundant downloads on redelivery.
if _, err := os.Stat(job.DestPath); err == nil {
    return job.DestPath, "cached", nil  // REQUIRED: return cached result, skip work
}
```

`````go
// cheap short-circuit: msgID dedup at publish time is the correctness
// boundary, this just avoids redundant downloads on redelivery.
if _, err := os.Stat(job.DestPath); err == nil {
    return job.DestPath, "cached", nil  // REQUIRED: return cached result, skip work
}
```
````
`````
