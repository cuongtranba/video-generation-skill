// worker/internal/jobhandler/tts.go
package jobhandler

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

// ttsUsdPerChar mirrors the api-owned cost constant (api/src/cost.ts
// TTS_USD_PER_CHAR): approximate TTS price per character in USD. Verify
// against the provider rate card before production use. The worker reports
// cost per event; it does not own cost-cap enforcement (that is api's job,
// per index §6).
const ttsUsdPerChar = 0.000010

// TTSHandler consumes TTS jobs, synthesizes scene narration via provider,
// and publishes VoiceSynthesized (or RunFailed on error) to store.
type TTSHandler struct {
	provider tts.TTSProvider
	store    *eventstore.Store
}

func NewTTSHandler(provider tts.TTSProvider, store *eventstore.Store) *TTSHandler {
	return &TTSHandler{provider: provider, store: store}
}

func (h *TTSHandler) Handle(ctx context.Context, subject string, job TTSJob) error {
	out, err := h.provider.Synthesize(ctx, tts.SynthesizeRequest{
		Text:  job.Text,
		Voice: job.Voice,
		Speed: job.Speed,
	}, job.DestPath)
	if err != nil {
		return publishFailure(ctx, h.store, job.ProjectID, "tts", job.SceneIdx, err)
	}

	ttsUsd := float64(out.CharsCharged) * ttsUsdPerChar
	ev := eventstore.NewVoiceSynthesized(job.ProjectID, job.SceneIdx, out.AudioPath, out.DurationSec, ttsUsd)
	if _, err := h.store.PublishResult(ctx, ev); err != nil {
		return fmt.Errorf("publish VoiceSynthesized for project %s scene %d: %w", job.ProjectID, job.SceneIdx, err)
	}
	return nil
}
