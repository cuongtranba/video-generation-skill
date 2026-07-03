package material

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// DurationProbe measures a media file's duration in seconds.
type DurationProbe func(ctx context.Context, path string) (float64, error)

// LocalSource serves user-provided assets from a resource directory.
type LocalSource struct {
	durationProbe DurationProbe
}

var _ MaterialSource = (*LocalSource)(nil)

func NewLocalSource(probe DurationProbe) *LocalSource {
	return &LocalSource{durationProbe: probe}
}

func (s *LocalSource) Name() string { return "local" }

var localExtTypes = map[string]AssetType{
	".jpg":  AssetImage,
	".jpeg": AssetImage,
	".png":  AssetImage,
	".webp": AssetImage,
	".mp4":  AssetVideo,
	".mov":  AssetVideo,
	".m4v":  AssetVideo,
}

// Scan inventories all supported media files in dir (non-recursive).
func (s *LocalSource) Scan(ctx context.Context, dir string) ([]Asset, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("scan resource dir %s: %w", dir, err)
	}

	var assets []Asset
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		assetType, ok := localExtTypes[strings.ToLower(filepath.Ext(e.Name()))]
		if !ok {
			continue
		}
		path := filepath.Join(dir, e.Name())
		asset := Asset{
			ID:     path,
			Type:   assetType,
			URL:    path,
			Source: s.Name(),
		}
		if assetType == AssetVideo && s.durationProbe != nil {
			duration, err := s.durationProbe(ctx, path)
			if err != nil {
				return nil, fmt.Errorf("probe local asset %s: %w", path, err)
			}
			asset.DurationSec = duration
		}
		assets = append(assets, asset)
	}
	return assets, nil
}

// Search is not applicable for local assets; the flow uses Scan and matches
// scenes to assets via the script's visual notes.
func (s *LocalSource) Search(ctx context.Context, req SearchRequest) ([]Asset, error) {
	return nil, nil
}

func (s *LocalSource) Download(ctx context.Context, asset Asset, destPath string) error {
	src, err := os.Open(asset.URL)
	if err != nil {
		return fmt.Errorf("open local asset %s: %w", asset.URL, err)
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create %s: %w", destPath, err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copy local asset %s to %s: %w", asset.URL, destPath, err)
	}
	return nil
}
