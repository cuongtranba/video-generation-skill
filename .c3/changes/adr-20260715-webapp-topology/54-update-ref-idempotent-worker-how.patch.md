---
target: ref-idempotent-worker
scope: block
base: ref-idempotent-worker#n30@v1:sha256:846871421d53ecd69c1ce934a4b8cf457034cc04ff03049c3dd801189d45f97d
---
Golden pattern — resolve the destination path, stat it, and short-circuit before the vendor/subprocess call (REQUIRED: existence check precedes work; the existing path is returned as the cached result). Source: `worker/internal/jobhandler/material.go`.

```go
// cheap short-circuit: msgID dedup at publish time is the correctness
// boundary, this just avoids redundant downloads on redelivery.
if _, err := os.Stat(job.DestPath); err == nil {
    return job.DestPath, "cached", nil  // REQUIRED: return cached result, skip work
}
```
