---
target: ref-idempotent-worker
scope: block
base: ref-idempotent-worker#n866@v1:sha256:8d6daa8062bf0a1385ad5a7fd5ca47c3f6c87fe0bd03460d3b342a65bac635b4
---
TTS is the only paid step (per-character ElevenLabs billing) and renders are slow; NATS JetStream may redeliver a message, and users re-run `generate` freely on the same project. An output-exists guard makes any re-run cost `$0` and semantically idempotent, instead of re-charging the vendor or re-rendering. The alternative — tracking completion in external state — was rejected because the artifact file itself is the ground truth already co-located with the project.
