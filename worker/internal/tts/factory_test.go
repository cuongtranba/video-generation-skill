package tts

import (
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

func TestNewFromConfig(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		wantType   string
		wantErrSub string
	}{
		{"elevenlabs", "elevenlabs", "elevenlabs", ""},
		{"unknown", "bogus", "", "unknown tts provider"},
		{"empty", "", "", "unknown tts provider"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := NewFromConfig(config.TTSSelect{Provider: tt.provider}, "key")
			if tt.wantErrSub != "" {
				if err == nil {
					t.Fatalf("want error containing %q, got nil", tt.wantErrSub)
				}
				if !strings.Contains(err.Error(), tt.wantErrSub) {
					t.Errorf("error = %q, want substring %q", err, tt.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewFromConfig: %v", err)
			}
			switch tt.wantType {
			case "elevenlabs":
				if _, ok := p.(*ElevenLabsProvider); !ok {
					t.Errorf("want *ElevenLabsProvider, got %T", p)
				}
			}
		})
	}
}
