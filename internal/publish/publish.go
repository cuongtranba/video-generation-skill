// Package publish uploads a rendered video to a distribution platform.
package publish

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

type PublishRequest struct {
	VideoPath string
	Caption   string
	Privacy   string // "public" | "private" (provider-mapped)
}

type PublishResult struct {
	PublishID string
	URL       string
}

// Publisher uploads a rendered video and returns the platform post reference.
type Publisher interface {
	Publish(ctx context.Context, req PublishRequest) (PublishResult, error)
}

// NewFromConfig builds a Publisher from the selected provider config.
// accessToken is the OAuth credential for the chosen platform.
func NewFromConfig(sel config.PublishSelect, accessToken string) (Publisher, error) {
	switch sel.Provider {
	case "tiktok":
		return NewTikTokPublisher(accessToken), nil
	case "youtube", "instagram":
		return nil, fmt.Errorf("publish provider %q not implemented yet (supported: tiktok)", sel.Provider)
	case "none", "":
		return nil, fmt.Errorf("no publish provider configured: set publish.provider in config.yaml (supported: tiktok)")
	default:
		return nil, fmt.Errorf("unknown publish provider %q (supported: tiktok)", sel.Provider)
	}
}
