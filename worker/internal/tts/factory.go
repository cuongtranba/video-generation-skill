package tts

import (
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

// NewFromConfig builds a TTSProvider from the selected provider name.
// apiKey is the credential for the chosen provider (from .env / env).
func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {
	switch sel.Provider {
	case "elevenlabs":
		return NewElevenLabsProvider(apiKey), nil
	default:
		return nil, fmt.Errorf("unknown tts provider %q (supported: elevenlabs)", sel.Provider)
	}
}
