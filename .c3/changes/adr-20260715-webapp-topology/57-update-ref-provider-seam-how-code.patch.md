---
target: ref-provider-seam
scope: block
base: ref-provider-seam#n22@v1:sha256:285d2efab6234b5de0b6922ffe30bc0dfb4cb09259c828d402349a81bfa1f8cd
---
```go
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
