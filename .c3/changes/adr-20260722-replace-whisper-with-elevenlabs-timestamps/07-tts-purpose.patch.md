---
target: c3-2003
scope: block
base: c3-2003#n588@v1:sha256:7ca7432481777eb9e935770e891df69b12e7db5cc43591f20b2a34aadc35afee
---
Owns the TTSProvider interface, ElevenLabsProvider (synchronous POST to /with-timestamps returning mp3 bytes plus character-level word timings; fixed voice ID), the per-scene tts{idx}.words.json word-timestamp sidecar write (via caption.WordsSidecarPath), and the NewFromConfig factory. ElevenLabs is the only provider. Non-goal: does not own the Voice/Speed domain types — those are in domain/.
