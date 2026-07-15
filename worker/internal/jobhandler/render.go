// worker/internal/jobhandler/render.go
package jobhandler

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/music"
	"github.com/cuongtranba/video-generation-skill/worker/internal/render"
)

// RenderHandler consumes render jobs, optionally resolves background music
// via musicSource, invokes the ffmpeg renderer, and publishes RenderCompleted
// (or RunFailed on error) to store.
type RenderHandler struct {
	renderer    render.Renderer
	musicSource music.MusicSource
	store       *eventstore.Store
}

func NewRenderHandler(renderer render.Renderer, musicSource music.MusicSource, store *eventstore.Store) *RenderHandler {
	return &RenderHandler{renderer: renderer, musicSource: musicSource, store: store}
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

// resolveMusicPath returns the local path to the background music file.
// If m.Path is set, it is used directly. If m.Search is set and m.Path is
// empty, the music source is queried and the top track is downloaded to
// <dir(outputPath)>/music.mp3. If both are empty, "" is returned (no music).
func (h *RenderHandler) resolveMusicPath(ctx context.Context, m *RenderMusicJob, outputPath string) (string, error) {
	if m.Path != "" {
		return m.Path, nil
	}
	if m.Search == "" {
		return "", nil
	}
	if h.musicSource == nil {
		return "", fmt.Errorf("music source not configured")
	}
	tracks, err := h.musicSource.Search(ctx, music.Query{Tags: m.Search, Limit: 1})
	if err != nil {
		return "", fmt.Errorf("search music %q: %w", m.Search, err)
	}
	if len(tracks) == 0 {
		return "", fmt.Errorf("no music found for query %q", m.Search)
	}
	dest := filepath.Join(filepath.Dir(outputPath), "music.mp3")
	if err := h.musicSource.Download(ctx, tracks[0], dest); err != nil {
		return "", fmt.Errorf("download music %q: %w", m.Search, err)
	}
	return dest, nil
}

func (h *RenderHandler) Handle(ctx context.Context, subject string, job RenderJob) error {
	var musicInput *render.MusicInput
	if job.Music != nil {
		resolvedPath, err := h.resolveMusicPath(ctx, job.Music, job.OutputPath)
		if err != nil {
			return publishFailure(ctx, h.store, job.ProjectID, "render", -1, err)
		}
		if resolvedPath != "" {
			musicInput = &render.MusicInput{Path: resolvedPath, DurationSec: job.Music.DurationSec, Volume: job.Music.Volume}
		}
	}

	out, err := h.renderer.Render(ctx, render.RenderRequest{
		Scenes:     toSceneInputs(job.Scenes),
		ASSPath:    job.ASSPath,
		Music:      musicInput,
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
