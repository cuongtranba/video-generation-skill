---
target: ref-provider-seam
scope: block
base: ref-provider-seam#n879@v1:sha256:ad3f528a877cb686ed384b705e33123f4207254b1fb579ee4ce22607ddb1d8cd
---
```go
func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {
	switch sel.Provider {
	case "elevenlabs":
		return NewElevenLabsProvider(apiKey), nil    // REQUIRED: return the interface
	default:
		return nil, fmt.Errorf("unknown tts provider %q (supported: elevenlabs)", sel.Provider)
	}
}
```
