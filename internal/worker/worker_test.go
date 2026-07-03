package worker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cuongtranba/video-generation-skill/internal/bus"
	"github.com/cuongtranba/video-generation-skill/internal/caption"
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/tts"
)

type stubTTS struct {
	calls atomic.Int32
}

var _ tts.TTSProvider = (*stubTTS)(nil)

func (s *stubTTS) Synthesize(ctx context.Context, req tts.SynthesizeRequest, destPath string) (tts.SynthesizeResult, error) {
	s.calls.Add(1)
	if err := os.WriteFile(destPath, []byte("mp3"), 0o644); err != nil {
		return tts.SynthesizeResult{}, err
	}
	return tts.SynthesizeResult{AudioPath: destPath, DurationSec: 3.5, CharsCharged: len([]rune(req.Text))}, nil
}

func newTestBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.NewEmbedded(t.TempDir())
	if err != nil {
		t.Fatalf("NewEmbedded: %v", err)
	}
	t.Cleanup(b.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.EnsureStreams(ctx); err != nil {
		t.Fatalf("EnsureStreams: %v", err)
	}
	return b
}

func awaitResult[T any](t *testing.T, ctx context.Context, b *bus.Bus, durable, filter string) T {
	t.Helper()
	got := make(chan T, 1)
	stop, err := bus.ConsumeJSON(ctx, b, bus.StreamResults, durable, filter, func(ctx context.Context, subject string, m T) error {
		got <- m
		return nil
	})
	if err != nil {
		t.Fatalf("consume results: %v", err)
	}
	t.Cleanup(stop)

	select {
	case m := <-got:
		return m
	case <-ctx.Done():
		t.Fatal("timeout waiting for result")
		panic("unreachable")
	}
}

func TestTTSWorkerProcessesJob(t *testing.T) {
	b := newTestBus(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	stub := &stubTTS{}
	w := NewTTSWorker(b, stub, func(ctx context.Context, path string) (float64, error) { return 3.5, nil })
	stop, err := w.Start(ctx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer stop()

	dest := filepath.Join(t.TempDir(), "scene0.mp3")
	job := TTSJob{ProjectID: "p1", SceneIndex: 0, Text: "Xin chào các bạn", Voice: domain.VoiceBanmai, DestPath: dest}
	if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindTTS, "p1", 0), job); err != nil {
		t.Fatalf("publish: %v", err)
	}

	res := awaitResult[TTSResult](t, ctx, b, "test-res-tts", "vidgen.result.tts.p1.>")
	if res.Error != "" {
		t.Fatalf("result error: %s", res.Error)
	}
	if res.AudioPath != dest || res.DurationSec != 3.5 {
		t.Errorf("result = %+v", res)
	}
	if stub.calls.Load() != 1 {
		t.Errorf("provider calls = %d, want 1", stub.calls.Load())
	}
}

func TestTTSWorkerIdempotentOnExistingFile(t *testing.T) {
	b := newTestBus(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	dest := filepath.Join(t.TempDir(), "scene0.mp3")
	if err := os.WriteFile(dest, []byte("already-there"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	stub := &stubTTS{}
	w := NewTTSWorker(b, stub, func(ctx context.Context, path string) (float64, error) { return 2.2, nil })
	stop, err := w.Start(ctx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer stop()

	job := TTSJob{ProjectID: "p2", SceneIndex: 0, Text: "Xin chào", Voice: domain.VoiceBanmai, DestPath: dest}
	if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindTTS, "p2", 0), job); err != nil {
		t.Fatalf("publish: %v", err)
	}

	res := awaitResult[TTSResult](t, ctx, b, "test-res-tts2", "vidgen.result.tts.p2.>")
	if res.Error != "" {
		t.Fatalf("result error: %s", res.Error)
	}
	if res.DurationSec != 2.2 {
		t.Errorf("duration = %v, want probed 2.2", res.DurationSec)
	}
	if stub.calls.Load() != 0 {
		t.Errorf("provider calls = %d, want 0 (idempotent skip)", stub.calls.Load())
	}
}

type stubTranscriber struct{}

var _ Transcriber = (*stubTranscriber)(nil)

func (s *stubTranscriber) Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error) {
	return []caption.WordTimestamp{
		{Word: "xin", Start: 0.0, End: 0.5},
		{Word: "chào", Start: 0.5, End: 1.0},
	}, nil
}

func TestCaptionWorkerOffsetsScenes(t *testing.T) {
	b := newTestBus(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	w := NewCaptionWorker(b, &stubTranscriber{}, caption.NewASSWriter())
	stop, err := w.Start(ctx)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer stop()

	dest := filepath.Join(t.TempDir(), "captions.ass")
	job := CaptionJob{
		ProjectID: "p3",
		SceneAudio: []SceneAudioRef{
			{AudioPath: "/a/v0.mp3", StartOffsetSec: 0},
			{AudioPath: "/a/v1.mp3", StartOffsetSec: 5.0},
		},
		Style:    domain.CaptionStyle{FontName: "Arial", FontSize: 48},
		DestPath: dest,
	}
	if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindCaption, "p3", 0), job); err != nil {
		t.Fatalf("publish: %v", err)
	}

	res := awaitResult[CaptionResult](t, ctx, b, "test-res-cap", "vidgen.result.caption.p3.>")
	if res.Error != "" {
		t.Fatalf("result error: %s", res.Error)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read ass: %v", err)
	}
	content := string(data)
	// second scene's words offset by 5s → dialogue starting at 0:00:05.00
	if !strings.Contains(content, "0:00:05.00") {
		t.Errorf("ASS missing offset dialogue:\n%s", content)
	}
}
