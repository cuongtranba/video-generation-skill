package flow

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/cuongtranba/video-generation-skill/internal/bus"
	"github.com/cuongtranba/video-generation-skill/internal/caption"
	"github.com/cuongtranba/video-generation-skill/internal/cost"
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/render"
	"github.com/cuongtranba/video-generation-skill/internal/worker"
)

// Progress receives human-readable generation updates.
type Progress func(msg string)

// Generate is step 5: run the NATS-backed pipeline — parallel TTS per scene,
// caption assembly, final render — with the cost wall enforced mid-flight.
func (f *Flow) Generate(ctx context.Context, p *domain.Project, outputPath string, progress Progress) error {
	if p.Status != domain.StatusConfirmed {
		return fmt.Errorf("project %s is %s, generate step needs confirmed", p.ID, p.Status)
	}
	if progress == nil {
		progress = func(string) {}
	}

	b, err := bus.NewEmbedded(filepath.Join(p.ProjectDir, ".nats"))
	if err != nil {
		return fmt.Errorf("start embedded bus: %w", err)
	}
	defer b.Close()

	if err := b.EnsureStreams(ctx); err != nil {
		return fmt.Errorf("ensure streams: %w", err)
	}

	ledger := cost.FromLedger(p.CostLedger)

	if err := f.runTTS(ctx, b, p, ledger, progress); err != nil {
		return err
	}
	if err := f.runCaption(ctx, b, p, progress); err != nil {
		return err
	}
	if err := f.runRender(ctx, b, p, outputPath, progress); err != nil {
		return err
	}

	p.OutputPath = outputPath
	p.CostLedger = ledger.Snapshot()
	p.Status = domain.StatusRendered
	p.UpdatedAt = f.now()
	if err := f.store.Save(p); err != nil {
		return fmt.Errorf("save project: %w", err)
	}
	progress(fmt.Sprintf("done: %s (actual cost $%.4f)", outputPath, ledger.ActualTotal()))
	return nil
}

func (f *Flow) runTTS(ctx context.Context, b *bus.Bus, p *domain.Project, ledger *cost.Ledger, progress Progress) error {
	w := worker.NewTTSWorker(b, f.tts, f.probe)
	stop, err := w.Start(ctx)
	if err != nil {
		return fmt.Errorf("start tts worker: %w", err)
	}
	defer stop()

	progress(fmt.Sprintf("synthesizing %d scenes with voice %s...", len(p.Scenes), p.Style.Voice))
	for i, scene := range p.Scenes {
		job := worker.TTSJob{
			ProjectID:  p.ID,
			SceneIndex: i,
			Text:       scene.Narration,
			Voice:      p.Style.Voice,
			Speed:      p.Style.Speed,
			DestPath:   filepath.Join(p.ProjectDir, fmt.Sprintf("scene%d_voice.mp3", i)),
		}
		if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindTTS, p.ID, i), job); err != nil {
			return fmt.Errorf("publish tts job for scene %d: %w", i, err)
		}
	}

	results, err := collectResults[worker.TTSResult](ctx, b, "orch-tts-"+p.ID,
		fmt.Sprintf("vidgen.result.tts.%s.>", p.ID), len(p.Scenes))
	if err != nil {
		return fmt.Errorf("collect tts results: %w", err)
	}

	for _, res := range results {
		if res.Error != "" {
			return fmt.Errorf("tts failed for scene %d: %s", res.SceneIndex, res.Error)
		}
		scene := &p.Scenes[res.SceneIndex]
		scene.AudioPath = res.AudioPath
		scene.DurationSec = res.DurationSec

		if res.CharsCharged > 0 {
			ledger.AddActual(cost.NewEstimator().EstimateTTS(int64(res.CharsCharged)))
			if err := ledger.CheckActual(); err != nil {
				return fmt.Errorf("cost wall breached during TTS: %w", err)
			}
		}
		progress(fmt.Sprintf("scene %d voiced (%.1fs)", res.SceneIndex, res.DurationSec))
	}

	if err := f.store.Save(p); err != nil {
		return fmt.Errorf("save project after tts: %w", err)
	}
	return nil
}

func (f *Flow) runCaption(ctx context.Context, b *bus.Bus, p *domain.Project, progress Progress) error {
	w := worker.NewCaptionWorker(b, f.transcriber, caption.NewASSWriter())
	stop, err := w.Start(ctx)
	if err != nil {
		return fmt.Errorf("start caption worker: %w", err)
	}
	defer stop()

	progress("transcribing for captions...")
	var refs []worker.SceneAudioRef
	var offset float64
	for _, scene := range p.Scenes {
		refs = append(refs, worker.SceneAudioRef{AudioPath: scene.AudioPath, StartOffsetSec: offset})
		offset += scene.DurationSec
	}

	job := worker.CaptionJob{
		ProjectID:  p.ID,
		SceneAudio: refs,
		Style:      p.Style.CaptionStyle,
		DestPath:   captionPath(p),
	}
	if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindCaption, p.ID, 0), job); err != nil {
		return fmt.Errorf("publish caption job: %w", err)
	}

	results, err := collectResults[worker.CaptionResult](ctx, b, "orch-cap-"+p.ID,
		fmt.Sprintf("vidgen.result.caption.%s.>", p.ID), 1)
	if err != nil {
		return fmt.Errorf("collect caption result: %w", err)
	}
	if results[0].Error != "" {
		return fmt.Errorf("caption generation failed: %s", results[0].Error)
	}
	progress("captions ready")
	return nil
}

func (f *Flow) runRender(ctx context.Context, b *bus.Bus, p *domain.Project, outputPath string, progress Progress) error {
	w := worker.NewRenderWorker(b, f.renderer)
	stop, err := w.Start(ctx)
	if err != nil {
		return fmt.Errorf("start render worker: %w", err)
	}
	defer stop()

	progress("rendering final video...")
	var scenes []render.SceneInput
	for _, scene := range p.Scenes {
		scenes = append(scenes, render.SceneInput{
			MediaPath:        scene.Material.LocalPath,
			AudioPath:        scene.AudioPath,
			IsImage:          scene.Material.Type == domain.MaterialImage || (scene.Material.Type == domain.MaterialLocal && isImagePath(scene.Material.LocalPath)),
			DurationSec:      scene.DurationSec,
			MediaDurationSec: scene.Material.DurationSec,
		})
	}

	var music *render.MusicInput
	if p.Style.MusicPath != "" {
		musicDuration, err := f.probe(ctx, p.Style.MusicPath)
		if err != nil {
			return fmt.Errorf("probe music %s: %w", p.Style.MusicPath, err)
		}
		music = &render.MusicInput{
			Path:        p.Style.MusicPath,
			DurationSec: musicDuration,
			Volume:      p.Style.MusicVolume,
		}
	}

	job := worker.RenderJob{
		ProjectID:  p.ID,
		Scenes:     scenes,
		ASSPath:    captionPath(p),
		Music:      music,
		OutputPath: outputPath,
	}
	if err := bus.PublishJSON(ctx, b, bus.JobSubject(bus.KindRender, p.ID, 0), job); err != nil {
		return fmt.Errorf("publish render job: %w", err)
	}

	results, err := collectResults[worker.RenderResult](ctx, b, "orch-render-"+p.ID,
		fmt.Sprintf("vidgen.result.render.%s.>", p.ID), 1)
	if err != nil {
		return fmt.Errorf("collect render result: %w", err)
	}
	if results[0].Error != "" {
		return fmt.Errorf("render failed: %s", results[0].Error)
	}
	progress(fmt.Sprintf("rendered %.1fs, %d bytes", results[0].DurationSec, results[0].FileSizeBytes))
	return nil
}

// collectResults consumes n results from the RESULTS stream.
func collectResults[T any](ctx context.Context, b *bus.Bus, durable, filter string, n int) ([]T, error) {
	got := make(chan T, n)
	stop, err := bus.ConsumeJSON(ctx, b, bus.StreamResults, durable, filter,
		func(ctx context.Context, subject string, m T) error {
			got <- m
			return nil
		})
	if err != nil {
		return nil, fmt.Errorf("consume %s: %w", filter, err)
	}
	defer stop()

	results := make([]T, 0, n)
	for len(results) < n {
		select {
		case m := <-got:
			results = append(results, m)
		case <-ctx.Done():
			return nil, fmt.Errorf("waiting for %d results on %s: %w", n, filter, ctx.Err())
		}
	}
	return results, nil
}
