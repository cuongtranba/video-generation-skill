---
target: c3-2007
scope: block
base: c3-2007#n690@v1:sha256:9358d92ec76c54a5fe6925358354eed272f62b7eaa07c81b3e9db2060aeb1e4c
---
Owns reading the per-scene tts{idx}.words.json word-timestamp sidecars (via caption.SidecarReader behind the Transcriber interface), karaoke caption line splitting (>0.8s gap = new line), and ASS file generation. One ASS file per project (not per scene). A missing sidecar fails the job loudly (RunFailed). Non-goal: does not own audio synthesis or timestamp capture — that is tts/.
