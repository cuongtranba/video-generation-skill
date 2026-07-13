---
target: c3-2
scope: block
base: c3-2#n462@v1:sha256:65c1323806b606a8abcf119634fb2c766e5c867e3a08d7bb659af22b92234ba1
---
## Goal

Be the Go media execution service that consumes job events off the external NATS event store and fans generation work out across idempotent workers — parallel per-scene TTS, then caption, then render — publishing result/asset events back to the event store with Nats-Msg-Id idempotency so redelivery and re-runs never repeat paid or slow work.
