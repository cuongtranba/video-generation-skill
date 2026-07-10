// worker/internal/jobhandler/render.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

// RenderHandler consumes render jobs, invokes the kept ffmpeg renderer, and
// publishes RenderCompleted (or RunFailed on error) to store.
type RenderHandler struct {
	renderer render.Renderer
	store    *eventstore.Store
}

func NewRenderHandler(renderer render.Renderer, store *eventstore.Store) *RenderHandler {
	return &RenderHandler{renderer: renderer, store: store}
}

func toSceneInputs(scenes []RenderSceneJob) []render.SceneInput {
	out := make([]render.SceneInput, len(scenes))
	for i, s := range scenes {
		out[i] = render.SceneInput{
			MediaPath:        s.MediaPath,
			AudioPath:        s.AudioPath,
			IsImage:          s.IsImage,
			DurationSec:      s.DurationSec,
			MediaDurationSec: s.MediaDurationSec,
		}
	}
	return out
}

func toMusicInput(m *RenderMusicJob) *render.MusicInput {
	if m == nil {
		return nil
	}
	return &render.MusicInput{Path: m.Path, DurationSec: m.DurationSec, Volume: m.Volume}
}

func (h *RenderHandler) Handle(ctx context.Context, subject string, job RenderJob) error {
	out, err := h.renderer.Render(ctx, render.RenderRequest{
		Scenes:     toSceneInputs(job.Scenes),
		ASSPath:    job.ASSPath,
		Music:      toMusicInput(job.Music),
		OutputPath: job.OutputPath,
	})
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "render", -1, err)
	}

	// render is local/free — index §6: "Enforced per-video cost = Σ
	// VoiceSynthesized.ttsUsd ... + render ($0)".
	ev := eventstore.NewRenderCompleted(job.ProjectID, out.OutputPath, 0)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish RenderCompleted for project %s: %w", job.ProjectID, err)
	}
	return nil
}
