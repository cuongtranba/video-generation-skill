// worker/internal/jobhandler/render_test.go
package jobhandler

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
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
	h := NewRenderHandler(renderer, store)

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
	h := NewRenderHandler(renderer, store)

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
