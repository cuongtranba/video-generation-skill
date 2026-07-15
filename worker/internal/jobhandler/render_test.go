//go:build integration

// worker/internal/jobhandler/render_test.go
package jobhandler

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/music"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

type stubRenderer struct {
	result render.RenderResult
	err    error
	got    render.RenderRequest
}

func (s *stubRenderer) Render(ctx context.Context, req render.RenderRequest) (render.RenderResult, error) {
	s.got = req
	if s.err != nil {
		return render.RenderResult{}, s.err
	}
	return s.result, nil
}

func TestRenderHandler_RendersAndPublishesRenderCompleted(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "out.mp4")
	renderer := &stubRenderer{result: render.RenderResult{OutputPath: outputPath, DurationSec: 12.0, FileSizeBytes: 1024}}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, nil, store)

	pid := newProjectID("proj")
	job := RenderJob{
		ProjectID: pid,
		Scenes:    []RenderSceneJob{{MediaPath: "scene0.mp4", AudioPath: "scene0.mp3", DurationSec: 5}},
		ASSPath:   "captions.ass",
		Music:     &RenderMusicJob{Path: "track.mp3", DurationSec: 30, Volume: 0.15},
		OutputPath: outputPath,
	}
	if err := h.Handle(context.Background(), "vidgen.job.render."+pid+".-", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(renderer.got.Scenes) != 1 || renderer.got.Scenes[0].MediaPath != "scene0.mp4" {
		t.Fatalf("Renderer.Render called with unexpected scenes: %+v", renderer.got.Scenes)
	}
	if renderer.got.Music == nil || renderer.got.Music.Path != "track.mp3" {
		t.Fatalf("Renderer.Render called with unexpected music: %+v", renderer.got.Music)
	}

	got := awaitEvent[eventstore.RenderCompleted](t, store, "vidgen.evt."+pid+".RenderCompleted")
	if got.OutputPath != outputPath || got.RenderUsd != 0 {
		t.Fatalf("unexpected RenderCompleted: %+v", got)
	}
}

func TestRenderHandler_RenderErrorPublishesRunFailed(t *testing.T) {
	renderer := &stubRenderer{err: errors.New("ffmpeg exit 1")}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, nil, store)

	pid := newProjectID("proj")
	job := RenderJob{ProjectID: pid, Scenes: []RenderSceneJob{{MediaPath: "scene0.mp4"}}, OutputPath: t.TempDir() + "/out.mp4"}
	if err := h.Handle(context.Background(), "vidgen.job.render."+pid+".-", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt."+pid+".RunFailed")
	if got.Stage != "render" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}

// TestRenderHandler_MusicSearchResolution verifies that when a RenderJob has
// Music.Search set and Music.Path empty, the handler calls the music source's
// Search then Download with a non-empty destination path, and render completes.
func TestRenderHandler_MusicSearchResolution(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "out.mp4")

	downloaded := make(chan string, 1)
	ms := &stubMusicSource{
		searchFn: func(ctx context.Context, q music.Query) ([]music.Track, error) {
			return []music.Track{{ID: "1", Name: "Chill Track", DurationSec: 60, DownloadURL: "http://example.com/track.mp3"}}, nil
		},
		downloadFn: func(ctx context.Context, track music.Track, dest string) error {
			downloaded <- dest
			return nil
		},
	}

	renderer := &stubRenderer{result: render.RenderResult{OutputPath: outputPath, DurationSec: 5.0, FileSizeBytes: 512}}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, ms, store)

	pid := newProjectID("proj")
	job := RenderJob{
		ProjectID:  pid,
		Scenes:     []RenderSceneJob{{MediaPath: "/m.mp4", AudioPath: "/a.mp3", DurationSec: 5, MediaDurationSec: 5}},
		ASSPath:    "/cap.ass",
		OutputPath: outputPath,
		Music:      &RenderMusicJob{Search: "chill acoustic", Volume: 0.3, Path: ""},
	}

	if err := h.Handle(context.Background(), "vidgen.job.render."+pid+".-", job); err != nil {
		t.Fatalf("Handle error: %v", err)
	}

	select {
	case dest := <-downloaded:
		if dest == "" {
			t.Error("expected non-empty download dest path")
		}
	default:
		t.Error("music was not downloaded")
	}

	if renderer.got.Music == nil {
		t.Fatal("expected renderer to receive music input, got nil")
	}
	if renderer.got.Music.Path == "" {
		t.Error("expected renderer music path to be non-empty resolved path")
	}

	got := awaitEvent[eventstore.RenderCompleted](t, store, "vidgen.evt."+pid+".RenderCompleted")
	if got.OutputPath != outputPath {
		t.Fatalf("unexpected RenderCompleted output path: %s", got.OutputPath)
	}
}

// TestRenderHandler_MusicSearchErrorPublishesRunFailed verifies that when the
// music source's Search returns an error, Handle publishes a RunFailed event
// (not a RenderCompleted) and does not panic.
func TestRenderHandler_MusicSearchErrorPublishesRunFailed(t *testing.T) {
	dir := t.TempDir()
	outputPath := filepath.Join(dir, "out.mp4")

	ms := &stubMusicSource{
		searchFn: func(ctx context.Context, q music.Query) ([]music.Track, error) {
			return nil, errors.New("music search failed")
		},
		downloadFn: func(ctx context.Context, track music.Track, dest string) error {
			return nil
		},
	}

	renderer := &stubRenderer{result: render.RenderResult{OutputPath: outputPath, DurationSec: 5.0, FileSizeBytes: 512}}
	store := newTestStore(t)
	h := NewRenderHandler(renderer, ms, store)

	pid := newProjectID("proj")
	job := RenderJob{
		ProjectID:  pid,
		Scenes:     []RenderSceneJob{{MediaPath: "/m.mp4", AudioPath: "/a.mp3", DurationSec: 5, MediaDurationSec: 5}},
		ASSPath:    "/cap.ass",
		OutputPath: outputPath,
		Music:      &RenderMusicJob{Search: "chill acoustic", Volume: 0.3, Path: ""},
	}

	if err := h.Handle(context.Background(), "vidgen.job.render."+pid+".-", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt."+pid+".RunFailed")
	if got.Stage != "render" {
		t.Fatalf("unexpected RunFailed stage: %q, want %q", got.Stage, "render")
	}
	if got.ProjectID != pid {
		t.Fatalf("unexpected RunFailed project id: %q, want %q", got.ProjectID, pid)
	}
}
