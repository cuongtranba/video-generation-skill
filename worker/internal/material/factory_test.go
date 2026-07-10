package material

import (
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

func TestNewFromConfigBuildsChainInOrder(t *testing.T) {
	keys := config.Config{PexelsAPIKey: "p", PixabayAPIKey: "x"}
	src, err := NewFromConfig(config.MaterialSelect{Providers: []string{"pixabay", "pexels"}}, keys)
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	ch, ok := src.(*Chain)
	if !ok {
		t.Fatalf("want *Chain, got %T", src)
	}
	if len(ch.sources) != 2 {
		t.Fatalf("want 2 sources, got %d", len(ch.sources))
	}
	if ch.sources[0].Name() != "pixabay" || ch.sources[1].Name() != "pexels" {
		t.Errorf("chain order = [%s, %s], want [pixabay, pexels]",
			ch.sources[0].Name(), ch.sources[1].Name())
	}
}

func TestNewFromConfigErrors(t *testing.T) {
	tests := []struct {
		name       string
		providers  []string
		wantErrSub string
	}{
		{"tiktok not implemented", []string{"tiktok"}, "not implemented"},
		{"unknown", []string{"giphy"}, "unknown material provider"},
		{"empty", nil, "no providers configured"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewFromConfig(config.MaterialSelect{Providers: tt.providers}, config.Config{})
			if err == nil {
				t.Fatalf("want error containing %q, got nil", tt.wantErrSub)
			}
			if !strings.Contains(err.Error(), tt.wantErrSub) {
				t.Errorf("error = %q, want substring %q", err, tt.wantErrSub)
			}
		})
	}
}
