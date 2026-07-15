// worker/internal/jobhandler/material.go
package jobhandler

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
)

// MaterialHandler consumes material jobs, resolves scene media via source
// (or in place if the job carries a user-provided local asset), and
// publishes MaterialResolved (or RunFailed on error) to store.
type MaterialHandler struct {
	source material.MaterialSource
	probe  material.DurationProbe
	store  *eventstore.Store
}

func NewMaterialHandler(source material.MaterialSource, probe material.DurationProbe, store *eventstore.Store) *MaterialHandler {
	return &MaterialHandler{source: source, probe: probe, store: store}
}

func isImagePath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	}
	return false
}

func (h *MaterialHandler) Handle(ctx context.Context, subject string, job MaterialJob) error {
	assetPath, source, err := h.resolve(ctx, job)
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "material", job.SceneIdx, err)
	}

	ev := eventstore.NewMaterialResolved(job.ProjectID, job.SceneIdx, source, assetPath)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish MaterialResolved for project %s scene %d: %w", job.ProjectID, job.SceneIdx, err)
	}
	return nil
}

// resolve returns the resolved media's path and the source that provided it
// ("local" for a user-provided asset, otherwise the MaterialSource's Name()
// — e.g. "pexels").
func (h *MaterialHandler) resolve(ctx context.Context, job MaterialJob) (assetPath, source string, err error) {
	if job.LocalAssetPath != "" {
		return job.LocalAssetPath, "local", nil
	}

	// cheap short-circuit: msgID dedup at publish time is the correctness
	// boundary, this just avoids redundant downloads on redelivery.
	if _, err := os.Stat(job.DestPath); err == nil {
		return job.DestPath, "cached", nil
	}

	assets, err := h.source.Search(ctx, material.SearchRequest{
		Query:       job.Query,
		Orientation: "portrait",
		Count:       3,
	})
	if err != nil {
		return "", "", fmt.Errorf("search material for %q: %w", job.Query, err)
	}
	if len(assets) == 0 {
		return "", "", fmt.Errorf("no material found for query %q", job.Query)
	}

	asset := assets[0]
	// The project media dir may not exist yet (e.g. no local asset was uploaded
	// to create it), so ensure it before writing the downloaded clip.
	if err := os.MkdirAll(filepath.Dir(job.DestPath), 0o755); err != nil {
		return "", "", fmt.Errorf("create media dir for %q: %w", job.DestPath, err)
	}
	if err := h.source.Download(ctx, asset, job.DestPath); err != nil {
		return "", "", fmt.Errorf("download material for %q: %w", job.Query, err)
	}
	return job.DestPath, asset.Source, nil
}
