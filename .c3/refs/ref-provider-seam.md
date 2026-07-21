---
id: ref-provider-seam
c3-seal: ff48356d9da3f2978206f47b187bd77a2f7165a2ec85ac658824360a6ffba651
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

Golden pattern — the factory selects an implementation from the config-supplied name and returns the category interface (REQUIRED: switch on `sel.Provider`, return the interface, error on unknown/unimplemented). Source: `worker/internal/tts/factory.go`, mirrored in `worker/internal/{material,music}/factory.go`.

`````go
func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {
	switch sel.Provider {
	case "fpt":
		return NewFPTAIProvider(apiKey), nil    // REQUIRED: return the interface
	case "elevenlabs":
		return NewElevenLabsProvider(apiKey), nil
	default:
		return nil, fmt.Errorf("unknown tts provider %q (supported: fpt, elevenlabs)", sel.Provider)
	}
}
```
````
`````
