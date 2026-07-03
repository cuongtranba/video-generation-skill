package flow

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/caption"
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/material"
	"github.com/cuongtranba/video-generation-skill/internal/music"
	"github.com/cuongtranba/video-generation-skill/internal/render"
	"github.com/cuongtranba/video-generation-skill/internal/script"
	"github.com/cuongtranba/video-generation-skill/internal/tts"
)

type stubScript struct{ scenes []domain.Scene }

var _ script.Generator = (*stubScript)(nil)

func (s *stubScript) Generate(ctx context.Context, req script.GenerateRequest) (script.GenerateResult, error) {
	return script.GenerateResult{Scenes: s.scenes}, nil
}

type stubStock struct{ assets []material.Asset }

var _ material.MaterialSource = (*stubStock)(nil)

func (s *stubStock) Search(ctx context.Context, req material.SearchRequest) ([]material.Asset, error) {
	return s.assets, nil
}
func (s *stubStock) Download(ctx context.Context, a material.Asset, dest string) error {
	return os.WriteFile(dest, []byte("media"), 0o644)
}
func (s *stubStock) Name() string { return "stub" }

type stubTTS struct{}

var _ tts.TTSProvider = (*stubTTS)(nil)

func (s *stubTTS) Synthesize(ctx context.Context, req tts.SynthesizeRequest, destPath string) (tts.SynthesizeResult, error) {
	if err := os.WriteFile(destPath, []byte("mp3"), 0o644); err != nil {
		return tts.SynthesizeResult{}, err
	}
	return tts.SynthesizeResult{AudioPath: destPath, DurationSec: 2.0, CharsCharged: len([]rune(req.Text))}, nil
}

type stubTranscriber struct{}

func (s *stubTranscriber) Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error) {
	return []caption.WordTimestamp{{Word: "xin", Start: 0, End: 0.5}, {Word: "chào", Start: 0.5, End: 1.0}}, nil
}

type stubRenderer struct{}

var _ render.Renderer = (*stubRenderer)(nil)

func (s *stubRenderer) Render(ctx context.Context, req render.RenderRequest) (render.RenderResult, error) {
	if err := os.WriteFile(req.OutputPath, []byte("mp4"), 0o644); err != nil {
		return render.RenderResult{}, err
	}
	return render.RenderResult{OutputPath: req.OutputPath, DurationSec: 4.0, FileSizeBytes: 3}, nil
}

func newTestFlow(t *testing.T) (*Flow, *domain.ManifestStore) {
	t.Helper()
	store := domain.NewManifestStore(t.TempDir())
	f := New(Deps{
		Store: store,
		Script: &stubScript{scenes: []domain.Scene{
			{Index: 0, Narration: "Nước ấm tốt cho sức khỏe", VisualNote: "warm water glass"},
			{Index: 1, Narration: "Uống mỗi sáng", VisualNote: "morning sunrise"},
		}},
		Local: material.NewLocalSource(func(ctx context.Context, path string) (float64, error) { return 6.0, nil }),
		Stock: &stubStock{assets: []material.Asset{
			{ID: "s1", Type: material.AssetVideo, URL: "http://x/v.mp4", DurationSec: 10, Source: "stub"},
		}},
		TTS:         &stubTTS{},
		Probe:       func(ctx context.Context, path string) (float64, error) { return 2.0, nil },
		Transcriber: &stubTranscriber{},
		Renderer:    &stubRenderer{},
	})
	return f, store
}

func runToConfirmed(t *testing.T, f *Flow) *domain.Project {
	t.Helper()
	ctx := context.Background()

	p, err := f.Draft(ctx, DraftOptions{Idea: "lợi ích nước ấm", DurationSec: 30, Tone: "casual"})
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}
	if p.Status != domain.StatusDraft || len(p.Scenes) != 2 {
		t.Fatalf("after draft: %+v", p)
	}

	if err := f.Material(ctx, p); err != nil {
		t.Fatalf("Material: %v", err)
	}
	if p.Status != domain.StatusMaterial {
		t.Fatalf("status = %s", p.Status)
	}
	for i, s := range p.Scenes {
		if s.Material.LocalPath == "" {
			t.Fatalf("scene %d has no material", i)
		}
	}

	speed := domain.Speed(1)
	if err := f.Tune(ctx, p, TuneOptions{Voice: domain.VoiceLannhi, Speed: &speed}); err != nil {
		t.Fatalf("Tune: %v", err)
	}
	if p.Style.Voice != domain.VoiceLannhi || p.Style.Speed != 1 {
		t.Fatalf("style = %+v", p.Style)
	}

	ledger, err := f.Confirm(ctx, p)
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if ledger.ProjectedTotal() <= 0 {
		t.Fatal("projected total should be positive")
	}
	if p.Status != domain.StatusConfirmed {
		t.Fatalf("status = %s", p.Status)
	}
	return p
}

func TestFullFlowToRendered(t *testing.T) {
	f, store := newTestFlow(t)
	p := runToConfirmed(t, f)

	out := filepath.Join(t.TempDir(), "out.mp4")
	var msgs []string
	err := f.Generate(context.Background(), p, out, func(m string) { msgs = append(msgs, m) })
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}

	if p.Status != domain.StatusRendered {
		t.Errorf("status = %s", p.Status)
	}
	if _, err := os.Stat(out); err != nil {
		t.Errorf("output missing: %v", err)
	}
	if p.CostLedger.ActualTotal() <= 0 {
		t.Error("actual cost should be recorded")
	}

	// reload from disk: everything persisted
	saved, err := store.Load(p.ID)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if saved.Status != domain.StatusRendered || saved.OutputPath != out {
		t.Errorf("persisted = %s %s", saved.Status, saved.OutputPath)
	}
	if len(msgs) == 0 {
		t.Error("no progress messages")
	}
}

func TestDraftValidation(t *testing.T) {
	f, _ := newTestFlow(t)
	tests := []struct {
		name string
		opts DraftOptions
	}{
		{"empty idea", DraftOptions{DurationSec: 30}},
		{"too short", DraftOptions{Idea: "x", DurationSec: 5}},
		{"too long", DraftOptions{Idea: "x", DurationSec: 120}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := f.Draft(context.Background(), tt.opts); err == nil {
				t.Error("want validation error")
			}
		})
	}
}

func TestStepOrderEnforced(t *testing.T) {
	f, _ := newTestFlow(t)
	p, err := f.Draft(context.Background(), DraftOptions{Idea: "x", DurationSec: 30})
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}

	// generate before confirm must fail
	if err := f.Generate(context.Background(), p, "/tmp/x.mp4", nil); err == nil {
		t.Error("Generate on draft project should fail")
	}
	// confirm before tune must fail
	if _, err := f.Confirm(context.Background(), p); err == nil {
		t.Error("Confirm on draft project should fail")
	}
}

type stubMusic struct{}

var _ music.MusicSource = (*stubMusic)(nil)

func (s *stubMusic) Search(ctx context.Context, q music.Query) ([]music.Track, error) {
	return []music.Track{{ID: "t1", Name: "Song", Artist: "Artist", DurationSec: 120, DownloadURL: "http://x/t1.mp3"}}, nil
}
func (s *stubMusic) Download(ctx context.Context, tr music.Track, dest string) error {
	return os.WriteFile(dest, []byte("music"), 0o644)
}

func TestTuneMusicSearch(t *testing.T) {
	f, _ := newTestFlow(t)
	f.music = &stubMusic{}
	ctx := context.Background()

	p, err := f.Draft(ctx, DraftOptions{Idea: "x", DurationSec: 30})
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}
	if err := f.Material(ctx, p); err != nil {
		t.Fatalf("Material: %v", err)
	}
	if err := f.Tune(ctx, p, TuneOptions{MusicSearch: "upbeat"}); err != nil {
		t.Fatalf("Tune: %v", err)
	}

	if p.Style.MusicPath == "" {
		t.Fatal("music path not set")
	}
	if _, err := os.Stat(p.Style.MusicPath); err != nil {
		t.Errorf("music file missing: %v", err)
	}
	if !strings.Contains(p.Style.MusicTrack, "Artist") {
		t.Errorf("attribution = %q", p.Style.MusicTrack)
	}
}

func TestTuneMusicFlagsExclusive(t *testing.T) {
	f, _ := newTestFlow(t)
	f.music = &stubMusic{}
	ctx := context.Background()

	p, err := f.Draft(ctx, DraftOptions{Idea: "x", DurationSec: 30})
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}
	if err := f.Material(ctx, p); err != nil {
		t.Fatalf("Material: %v", err)
	}
	if err := f.Tune(ctx, p, TuneOptions{MusicPath: "/a.mp3", MusicSearch: "upbeat"}); err == nil {
		t.Fatal("want error for both music flags")
	}
}

func TestMaterialUsesLocalAsset(t *testing.T) {
	dir := t.TempDir()
	assetPath := filepath.Join(dir, "cup.jpg")
	if err := os.WriteFile(assetPath, []byte("img"), 0o644); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	store := domain.NewManifestStore(t.TempDir())
	f := New(Deps{
		Store: store,
		Script: &stubScript{scenes: []domain.Scene{
			{Index: 0, Narration: "Cảnh một", VisualNote: "asset:" + assetPath},
		}},
		Local: material.NewLocalSource(nil),
		Stock: &stubStock{},
		Probe: func(ctx context.Context, path string) (float64, error) { return 0, nil },
	})

	p, err := f.Draft(context.Background(), DraftOptions{Idea: "test", DurationSec: 30})
	if err != nil {
		t.Fatalf("Draft: %v", err)
	}
	if err := f.Material(context.Background(), p); err != nil {
		t.Fatalf("Material: %v", err)
	}

	m := p.Scenes[0].Material
	if m.Type != domain.MaterialLocal || m.LocalPath != assetPath {
		t.Errorf("material = %+v", m)
	}
	if !strings.HasSuffix(m.LocalPath, ".jpg") {
		t.Errorf("local path = %q", m.LocalPath)
	}
}
