// worker/internal/jobhandler/caption.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
)

// Transcriber yields word-level timestamps for an audio file. Narrow
// interface re-declared here (mirrors internal/worker.Transcriber) since
// internal/worker is not a kept package.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error)
}

var _ Transcriber = (*caption.SidecarReader)(nil)

// CaptionHandler consumes caption jobs, transcribes every scene's audio,
// writes one merged ASS file for the project, and publishes CaptionsBuilt
// (or RunFailed on error) to store.
type CaptionHandler struct {
	transcriber Transcriber
	writer      *caption.ASSWriter
	store       *eventstore.Store
}

func NewCaptionHandler(transcriber Transcriber, writer *caption.ASSWriter, store *eventstore.Store) *CaptionHandler {
	return &CaptionHandler{transcriber: transcriber, writer: writer, store: store}
}

func (h *CaptionHandler) Handle(ctx context.Context, subject string, job CaptionJob) error {
	var allWords []caption.WordTimestamp
	for _, ref := range job.SceneAudio {
		words, err := h.transcriber.Transcribe(ctx, ref.AudioPath)
		if err != nil {
			return publishFailure(ctx, h.store, job.ProjectID, "caption", -1, fmt.Errorf("transcribe %s: %w", ref.AudioPath, err))
		}
		// Display the authoritative narration text on the transcriber's timing.
		words = caption.AlignNarration(ref.Narration, words)
		for _, w := range words {
			allWords = append(allWords, caption.WordTimestamp{
				Word:  w.Word,
				Start: w.Start + ref.StartOffsetSec,
				End:   w.End + ref.StartOffsetSec,
			})
		}
	}

	if err := h.writer.Write(allWords, job.Style, job.DestPath); err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "caption", -1, fmt.Errorf("write ASS: %w", err))
	}

	ev := eventstore.NewCaptionsBuilt(job.ProjectID, job.DestPath)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish CaptionsBuilt for project %s: %w", job.ProjectID, err)
	}
	return nil
}
