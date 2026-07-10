// worker/internal/jobhandler/caption_test.go
package jobhandler

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

type stubTranscriber struct {
	words map[string][]caption.WordTimestamp
	err   error
}

func (s *stubTranscriber) Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.words[audioPath], nil
}

func TestCaptionHandler_WritesASSAndPublishesCaptionsBuilt(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "captions.ass")
	transcriber := &stubTranscriber{words: map[string][]caption.WordTimestamp{
		"scene0.mp3": {{Word: "xin", Start: 0, End: 0.3}, {Word: "chao", Start: 0.3, End: 0.6}},
	}}
	store := newTestStore(t)
	h := NewCaptionHandler(transcriber, caption.NewASSWriter(), store)

	job := CaptionJob{
		ProjectID:  "proj6",
		SceneAudio: []SceneAudioRef{{AudioPath: "scene0.mp3", StartOffsetSec: 0}},
		Style:      domain.CaptionStyle{},
		DestPath:   destPath,
	}
	if err := h.Handle(context.Background(), "vidgen.job.caption.proj6.-", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := awaitEvent[eventstore.CaptionsBuilt](t, store, "vidgen.evt.proj6.CaptionsBuilt")
	if got.ASSPath != destPath || got.SceneIdx != 0 {
		t.Fatalf("unexpected CaptionsBuilt: %+v", got)
	}
}

func TestCaptionHandler_TranscribeErrorPublishesRunFailed(t *testing.T) {
	transcriber := &stubTranscriber{err: errors.New("whisper crashed")}
	store := newTestStore(t)
	h := NewCaptionHandler(transcriber, caption.NewASSWriter(), store)

	job := CaptionJob{
		ProjectID:  "proj7",
		SceneAudio: []SceneAudioRef{{AudioPath: "scene0.mp3"}},
		DestPath:   t.TempDir() + "/captions.ass",
	}
	if err := h.Handle(context.Background(), "vidgen.job.caption.proj7.-", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt.proj7.RunFailed")
	if got.Stage != "caption" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
