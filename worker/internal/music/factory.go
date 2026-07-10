package music

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

// NewFromConfig builds a MusicSource from the selected provider name.
func NewFromConfig(sel config.MusicSelect, clientID string) (MusicSource, error) {
	switch sel.Provider {
	case "jamendo":
		return NewJamendoSource(clientID), nil
	case "none":
		return noopSource{}, nil
	default:
		return nil, fmt.Errorf("unknown music provider %q (supported: jamendo, none)", sel.Provider)
	}
}

// noopSource disables background music: no tracks, never downloads.
type noopSource struct{}

var _ MusicSource = noopSource{}

func (noopSource) Search(ctx context.Context, q Query) ([]Track, error) { return nil, nil }

func (noopSource) Download(ctx context.Context, track Track, destPath string) error {
	return fmt.Errorf("music disabled (provider: none): nothing to download")
}
