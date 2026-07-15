---
target: ref-provider-seam
scope: block
base: ref-provider-seam#n21@v1:sha256:8abcf77a38e0045116a6a4fd092f8773a5f595d6ea729f9e271235c5424e018d
---
Golden pattern — the factory selects an implementation from the config-supplied name and returns the category interface (REQUIRED: switch on `sel.Provider`, return the interface, error on unknown/unimplemented). Source: `worker/internal/tts/factory.go`, mirrored in `worker/internal/{material,music}/factory.go`.
