package material

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
)

type AssetType string

const (
	AssetVideo AssetType = "video"
	AssetImage AssetType = "image"
)

type SearchRequest struct {
	Query       string
	Orientation string
	MinDuration float64
	MaxDuration float64
	Count       int
}

type Asset struct {
	ID          string
	Type        AssetType
	URL         string
	Width       int
	Height      int
	DurationSec float64
	Source      string
}

type MaterialSource interface {
	Search(ctx context.Context, req SearchRequest) ([]Asset, error)
	Download(ctx context.Context, asset Asset, destPath string) error
	Name() string
}

// Chain tries each source in order and returns the first non-empty result.
type Chain struct {
	sources []MaterialSource
}

var _ MaterialSource = (*Chain)(nil)

func NewChain(sources ...MaterialSource) *Chain {
	return &Chain{sources: sources}
}

func (c *Chain) Search(ctx context.Context, req SearchRequest) ([]Asset, error) {
	var lastErr error
	for _, src := range c.sources {
		assets, err := src.Search(ctx, req)
		if err != nil {
			lastErr = fmt.Errorf("search %s: %w", src.Name(), err)
			continue
		}
		if len(assets) > 0 {
			return assets, nil
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, nil
}

func (c *Chain) Download(ctx context.Context, asset Asset, destPath string) error {
	for _, src := range c.sources {
		if src.Name() == asset.Source {
			return src.Download(ctx, asset, destPath)
		}
	}
	return fmt.Errorf("no source named %q for asset %s", asset.Source, asset.ID)
}

func (c *Chain) Name() string { return "chain" }

func downloadURL(ctx context.Context, client *http.Client, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build download request for %s: %w", url, err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create %s: %w", destPath, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write %s: %w", destPath, err)
	}
	return nil
}
