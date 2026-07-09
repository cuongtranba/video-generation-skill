package tts

import (
	"fmt"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

// NewFromConfig builds a TTSProvider from the selected provider name.
// apiKey is the credential for the chosen provider (from .env / env).
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
