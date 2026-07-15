---
target: ref-idempotent-worker
scope: block
base: ref-idempotent-worker#n31@v1:sha256:ddb9c7caa3f949975738b9363ace2d4bd469a5866a01ff2c1fd3d441dc6c7062
---
```go
// cheap short-circuit: msgID dedup at publish time is the correctness
// boundary, this just avoids redundant downloads on redelivery.
if _, err := os.Stat(job.DestPath); err == nil {
    return job.DestPath, "cached", nil  // REQUIRED: return cached result, skip work
}
```
