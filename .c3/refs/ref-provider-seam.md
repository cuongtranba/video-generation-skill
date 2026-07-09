---
id: ref-provider-seam
c3-seal: e340b74ab085384db0d661cd5e1b1256cd678a65df5f8470b8a5e39e2fa13a11
title: Pluggable provider adapters via config-driven factory seam
type: ref
goal: 'Every external vendor category — TTS, background music, stock material, AI clip-generation, publishing — must be swappable without editing the pipeline that calls it. The consistency need: one selection point per category, a stable in-code seam callers depend on instead of a concrete vendor.'
---

## Goal

Every external vendor category — TTS, background music, stock material, AI clip-generation, publishing — must be swappable without editing the pipeline that calls it. The consistency need: one selection point per category, a stable in-code seam callers depend on instead of a concrete vendor.

## Choice

Each category package exposes a `NewFromConfig` factory that returns a category interface (`TTSProvider`, `MusicSource`, `MaterialSource`, `ClipGenerator`, `Publisher`). `~/.vidgen/config.yaml` names which implementation to build; secret keys stay in `.env` and are validated per selected provider. Callers hold the interface, never a vendor type.

## Why

The pipeline integrates vendors with divergent, churning APIs (FPT.AI, Jamendo, Pexels/Pixabay, TikTok, future Runway/Kling). Without a single config-driven factory seam, swapping or adding a vendor would touch every call site and secrets would leak into config. Binding callers to a category interface and centralizing construction in one factory means a vendor change is one `case` in one switch plus one config line — the alternative (direct vendor use at call sites) was rejected because it couples orchestration to vendor lifecycles.

## How

Golden pattern — the factory selects an implementation from the config-supplied name and returns the category interface (REQUIRED: switch on `sel.Provider`, return the interface, error on unknown/unimplemented). Source: `internal/tts/factory.go`, mirrored in `internal/{music,material,publish}/factory.go`.

```go
func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {
	switch sel.Provider {
	case "fpt":
		return NewFPTAIProvider(apiKey), nil
	case "elevenlabs":
		return nil, fmt.Errorf("tts provider %q not implemented yet (supported: fpt)", sel.Provider)
	default:
		return nil, fmt.Errorf("unknown tts provider %q (supported: fpt)", sel.Provider)
	}
}
```
