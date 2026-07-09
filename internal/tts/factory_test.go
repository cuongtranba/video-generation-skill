package tts

import (
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfigFPT(t *testing.T) {
	p, err := NewFromConfig(config.TTSSelect{Provider: "fpt"}, "key")
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	if _, ok := p.(*FPTAIProvider); !ok {
		t.Errorf("want *FPTAIProvider, got %T", p)
	}
}

func TestNewFromConfigElevenLabsNotImplemented(t *testing.T) {
	if _, err := NewFromConfig(config.TTSSelect{Provider: "elevenlabs"}, "key"); err == nil {
		t.Fatal("want not-implemented error")
	}
}

func TestNewFromConfigUnknown(t *testing.T) {
	if _, err := NewFromConfig(config.TTSSelect{Provider: "bogus"}, "key"); err == nil {
		t.Fatal("want unknown-provider error")
	}
}
