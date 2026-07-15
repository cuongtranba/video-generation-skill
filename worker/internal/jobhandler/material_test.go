//go:build integration

// worker/internal/jobhandler/material_test.go
package jobhandler

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/material"
)

type stubMaterialSource struct {
	assets    []material.Asset
	searchErr error
	downloads []material.Asset
}

func (s *stubMaterialSource) Search(ctx context.Context, req material.SearchRequest) ([]material.Asset, error) {
	if s.searchErr != nil {
		return nil, s.searchErr
	}
	return s.assets, nil
}

func (s *stubMaterialSource) Download(ctx context.Context, asset material.Asset, destPath string) error {
	s.downloads = append(s.downloads, asset)
	return os.WriteFile(destPath, []byte("stub-media"), 0o644)
}

func (s *stubMaterialSource) Name() string { return "stub" }

func TestMaterialHandler_DownloadsAndPublishesMaterialResolved(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "scene-0.mp4")
	source := &stubMaterialSource{assets: []material.Asset{
		{ID: "a1", Type: material.AssetVideo, Source: "stub", DurationSec: 5},
	}}
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	pid := newProjectID("proj")
	job := MaterialJob{ProjectID: pid, SceneIdx: 0, Query: "sunset", DestPath: destPath}
	if err := h.Handle(context.Background(), "vidgen.job.material."+pid+".0", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if _, err := os.Stat(destPath); err != nil {
		t.Fatalf("expected downloaded file at %s: %v", destPath, err)
	}
	if len(source.downloads) != 1 {
		t.Fatalf("want 1 download call, got %d", len(source.downloads))
	}

	got := awaitEvent[eventstore.MaterialResolved](t, store, "vidgen.evt."+pid+".MaterialResolved")
	if got.SceneIdx != 0 || got.AssetPath != destPath || got.Source != "stub" {
		t.Fatalf("unexpected MaterialResolved: %+v", got)
	}
}

func TestMaterialHandler_CreatesMissingDestDir(t *testing.T) {
	// DestPath lives in a project media dir that does not exist yet (no local
	// asset was uploaded to create it). The handler must mkdir it before writing.
	dir := t.TempDir()
	destPath := filepath.Join(dir, "proj-xyz", "scene-0.mp4") // proj-xyz/ absent
	source := &stubMaterialSource{assets: []material.Asset{
		{ID: "a1", Type: material.AssetVideo, Source: "stub", DurationSec: 5},
	}}
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	pid := newProjectID("proj")
	job := MaterialJob{ProjectID: pid, SceneIdx: 0, Query: "sunset", DestPath: destPath}
	if err := h.Handle(context.Background(), "vidgen.job.material."+pid+".0", job); err != nil {
		t.Fatalf("Handle should create the missing dir and succeed, got: %v", err)
	}
	if _, err := os.Stat(destPath); err != nil {
		t.Fatalf("expected downloaded file at %s: %v", destPath, err)
	}
}

func TestMaterialHandler_LocalAssetSkipsDownload(t *testing.T) {
	dir := t.TempDir()
	localPath := filepath.Join(dir, "user-photo.jpg")
	if err := os.WriteFile(localPath, []byte("jpg"), 0o644); err != nil {
		t.Fatalf("seed local asset: %v", err)
	}
	source := &stubMaterialSource{}
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	pid := newProjectID("proj")
	job := MaterialJob{ProjectID: pid, SceneIdx: 1, LocalAssetPath: localPath, DestPath: filepath.Join(dir, "unused.mp4")}
	if err := h.Handle(context.Background(), "vidgen.job.material."+pid+".1", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(source.downloads) != 0 {
		t.Fatalf("local asset must not trigger a download, got %d calls", len(source.downloads))
	}

	got := awaitEvent[eventstore.MaterialResolved](t, store, "vidgen.evt."+pid+".MaterialResolved")
	if got.AssetPath != localPath || got.Source != "local" {
		t.Fatalf("unexpected MaterialResolved: %+v", got)
	}
}

func TestMaterialHandler_NoResultsPublishesRunFailed(t *testing.T) {
	source := &stubMaterialSource{} // empty Search result
	store := newTestStore(t)
	h := NewMaterialHandler(source, nil, store)

	pid := newProjectID("proj")
	job := MaterialJob{ProjectID: pid, SceneIdx: 4, Query: "nonexistent", DestPath: t.TempDir() + "/scene-4.mp4"}
	if err := h.Handle(context.Background(), "vidgen.job.material."+pid+".4", job); err != nil {
		t.Fatalf("Handle should ack (return nil) after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt."+pid+".RunFailed")
	if got.Stage != "material" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
