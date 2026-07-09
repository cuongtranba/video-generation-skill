package publish

import (
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfig(t *testing.T) {
	tests := []struct {
		name       string
		provider   string
		wantTikTok bool
		wantErrSub string
	}{
		{"tiktok", "tiktok", true, ""},
		{"youtube not implemented", "youtube", false, "not implemented"},
		{"instagram not implemented", "instagram", false, "not implemented"},
		{"none", "none", false, "no publish provider configured"},
		{"empty", "", false, "no publish provider configured"},
		{"unknown", "vimeo", false, "unknown publish provider"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := NewFromConfig(config.PublishSelect{Provider: tt.provider}, "token")
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
			if tt.wantTikTok {
				if _, ok := p.(*TikTokPublisher); !ok {
					t.Errorf("want *TikTokPublisher, got %T", p)
				}
			}
		})
	}
}
