// worker/internal/jobhandler/tts_test.go
package jobhandler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
	"github.com/cuongtranba/video-generation-skill/worker/internal/eventstore"
	"github.com/cuongtranba/video-generation-skill/worker/internal/tts"
)

type stubTTSProvider struct {
	result tts.SynthesizeResult
	err    error
}

func (s *stubTTSProvider) Synthesize(ctx context.Context, req tts.SynthesizeRequest, destPath string) (tts.SynthesizeResult, error) {
	if s.err != nil {
		return tts.SynthesizeResult{}, s.err
	}
	if err := os.WriteFile(destPath, []byte("mp3"), 0o644); err != nil {
		return tts.SynthesizeResult{}, err
	}
	return s.result, nil
}

func TestTTSHandler_SynthesizesAndPublishesVoiceSynthesized(t *testing.T) {
	dir := t.TempDir()
	destPath := filepath.Join(dir, "scene-0.mp3")
	provider := &stubTTSProvider{result: tts.SynthesizeResult{AudioPath: destPath, DurationSec: 3.5, CharsCharged: 42}}
	store := newTestStore(t)
	h := NewTTSHandler(provider, store)

	pid := newProjectID("proj")
	job := TTSJob{ProjectID: pid, SceneIdx: 0, Text: "xin chao", Voice: domain.VoiceBanmai, Speed: 0, DestPath: destPath}
	if err := h.Handle(context.Background(), "vidgen.job.tts."+pid+".0", job); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	got := awaitEvent[eventstore.VoiceSynthesized](t, store, "vidgen.evt."+pid+".VoiceSynthesized")
	if got.SceneIdx != 0 || got.MP3Path != destPath {
		t.Fatalf("unexpected VoiceSynthesized: %+v", got)
	}
	if got.TTSUsd <= 0 {
		t.Fatalf("expected TTSUsd > 0 for 42 charged chars, got %v", got.TTSUsd)
	}
}

func TestTTSHandler_ProviderErrorPublishesRunFailed(t *testing.T) {
	provider := &stubTTSProvider{err: errors.New("FPT.AI rejected request")}
	store := newTestStore(t)
	h := NewTTSHandler(provider, store)

	pid := newProjectID("proj")
	job := TTSJob{ProjectID: pid, SceneIdx: 3, Text: "loi thoai", Voice: domain.VoiceBanmai, DestPath: t.TempDir() + "/scene-3.mp3"}
	if err := h.Handle(context.Background(), "vidgen.job.tts."+pid+".3", job); err != nil {
		t.Fatalf("Handle should ack after publishing RunFailed, got error: %v", err)
	}

	got := awaitEvent[eventstore.RunFailed](t, store, "vidgen.evt."+pid+".RunFailed")
	if got.Stage != "tts" {
		t.Fatalf("unexpected RunFailed: %+v", got)
	}
}
