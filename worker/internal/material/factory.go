package material

import (
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

// NewFromConfig builds a MaterialSource (a Chain) from an ordered provider list.
// The first provider in the list is tried first during search.
func NewFromConfig(sel config.MaterialSelect, keys config.Config) (MaterialSource, error) {
	if len(sel.Providers) == 0 {
		return nil, fmt.Errorf("material: no providers configured (supported: pexels, pixabay)")
	}
	sources := make([]MaterialSource, 0, len(sel.Providers))
	for _, name := range sel.Providers {
		switch name {
		case "pexels":
			sources = append(sources, NewPexelsSource(keys.PexelsAPIKey))
		case "pixabay":
			sources = append(sources, NewPixabaySource(keys.PixabayAPIKey))
		case "tiktok":
			return nil, fmt.Errorf("material provider %q not implemented yet: no compliant public download API (supported: pexels, pixabay)", name)
		default:
			return nil, fmt.Errorf("unknown material provider %q (supported: pexels, pixabay)", name)
		}
	}
	return NewChain(sources...), nil
}
