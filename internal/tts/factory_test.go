package tts

import (
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfig(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		wantFPT    bool
		wantErrSub string
	}{
		{"fpt", "fpt", true, ""},
		{"elevenlabs not implemented", "elevenlabs", false, "not implemented"},
		{"unknown", "bogus", false, "unknown tts provider"},
		{"empty", "", false, "unknown tts provider"},
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
			if tt.wantFPT {
				if _, ok := p.(*FPTAIProvider); !ok {
					t.Errorf("want *FPTAIProvider, got %T", p)
				}
			}
		})
	}
}
