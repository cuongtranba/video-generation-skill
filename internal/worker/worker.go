package worker

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/cuongtranba/video-generation-skill/internal/bus"
	"github.com/cuongtranba/video-generation-skill/internal/caption"
	"github.com/cuongtranba/video-generation-skill/internal/material"
	"github.com/cuongtranba/video-generation-skill/internal/render"
	"github.com/cuongtranba/video-generation-skill/internal/tts"
)

// Transcriber yields word-level timestamps for an audio file.
type Transcriber interface {
	Transcribe(ctx context.Context, audioPath string) ([]caption.WordTimestamp, error)
}

var _ Transcriber = (*caption.WhisperRunner)(nil)

// TTSWorker consumes TTS jobs and produces voiceover files.
type TTSWorker struct {
	bus      *bus.Bus
	provider tts.TTSProvider
	probe    tts.DurationProbe
}

func NewTTSWorker(b *bus.Bus, provider tts.TTSProvider, probe tts.DurationProbe) *TTSWorker {
	return &TTSWorker{bus: b, provider: provider, probe: probe}
}

func (w *TTSWorker) Start(ctx context.Context) (bus.StopFunc, error) {
	return bus.ConsumeJSON(ctx, w.bus, bus.StreamJobs, "tts-worker", "vidgen.job.tts.>",
		func(ctx context.Context, subject string, job TTSJob) error {
			res := w.handle(ctx, job)
			return bus.PublishJSON(ctx, w.bus, bus.ResultSubject(bus.KindTTS, job.ProjectID, job.SceneIndex), res)
		})
}

func (w *TTSWorker) handle(ctx context.Context, job TTSJob) TTSResult {
	res := TTSResult{ProjectID: job.ProjectID, SceneIndex: job.SceneIndex}

	// idempotent re-consume: audio already synthesized on a previous run
	if _, err := os.Stat(job.DestPath); err == nil {
		duration, err := w.probe(ctx, job.DestPath)
		if err != nil {
			res.Error = fmt.Sprintf("probe existing audio: %v", err)
			return res
		}
		res.AudioPath = job.DestPath
		res.DurationSec = duration
		return res
	}

	out, err := w.provider.Synthesize(ctx, tts.SynthesizeRequest{
		Text:  job.Text,
		Voice: job.Voice,
		Speed: job.Speed,
	}, job.DestPath)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.AudioPath = out.AudioPath
	res.DurationSec = out.DurationSec
	res.CharsCharged = out.CharsCharged
	return res
}

// MaterialWorker consumes material jobs and downloads scene media.
type MaterialWorker struct {
	bus    *bus.Bus
	source material.MaterialSource
	probe  material.DurationProbe
}

func NewMaterialWorker(b *bus.Bus, source material.MaterialSource, probe material.DurationProbe) *MaterialWorker {
	return &MaterialWorker{bus: b, source: source, probe: probe}
}

func (w *MaterialWorker) Start(ctx context.Context) (bus.StopFunc, error) {
	return bus.ConsumeJSON(ctx, w.bus, bus.StreamJobs, "material-worker", "vidgen.job.material.>",
		func(ctx context.Context, subject string, job MaterialJob) error {
			res := w.handle(ctx, job)
			return bus.PublishJSON(ctx, w.bus, bus.ResultSubject(bus.KindMaterial, job.ProjectID, job.SceneIndex), res)
		})
}

func isImagePath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	}
	return false
}

func (w *MaterialWorker) handle(ctx context.Context, job MaterialJob) MaterialResult {
	res := MaterialResult{ProjectID: job.ProjectID, SceneIndex: job.SceneIndex}

	// user-provided asset: use in place, no download
	if job.LocalAssetPath != "" {
		res.MediaPath = job.LocalAssetPath
		res.IsImage = isImagePath(job.LocalAssetPath)
		if !res.IsImage && w.probe != nil {
			duration, err := w.probe(ctx, job.LocalAssetPath)
			if err != nil {
				res.Error = fmt.Sprintf("probe local asset: %v", err)
				return res
			}
			res.DurationSec = duration
		}
		return res
	}

	// idempotent re-consume
	if _, err := os.Stat(job.DestPath); err == nil {
		res.MediaPath = job.DestPath
		res.IsImage = isImagePath(job.DestPath)
		return res
	}

	assets, err := w.source.Search(ctx, material.SearchRequest{
		Query:       job.Query,
		Orientation: "portrait",
		Count:       3,
	})
	if err != nil {
		res.Error = err.Error()
		return res
	}
	if len(assets) == 0 {
		res.Error = fmt.Sprintf("no material found for query %q", job.Query)
		return res
	}

	asset := assets[0]
	if err := w.source.Download(ctx, asset, job.DestPath); err != nil {
		res.Error = err.Error()
		return res
	}
	res.MediaPath = job.DestPath
	res.IsImage = asset.Type == material.AssetImage
	res.DurationSec = asset.DurationSec
	return res
}

// CaptionWorker transcribes scene audio and writes one ASS file per project.
type CaptionWorker struct {
	bus         *bus.Bus
	transcriber Transcriber
	writer      *caption.ASSWriter
}

func NewCaptionWorker(b *bus.Bus, transcriber Transcriber, writer *caption.ASSWriter) *CaptionWorker {
	return &CaptionWorker{bus: b, transcriber: transcriber, writer: writer}
}

func (w *CaptionWorker) Start(ctx context.Context) (bus.StopFunc, error) {
	return bus.ConsumeJSON(ctx, w.bus, bus.StreamJobs, "caption-worker", "vidgen.job.caption.>",
		func(ctx context.Context, subject string, job CaptionJob) error {
			res := w.handle(ctx, job)
			return bus.PublishJSON(ctx, w.bus, bus.ResultSubject(bus.KindCaption, job.ProjectID, 0), res)
		})
}

func (w *CaptionWorker) handle(ctx context.Context, job CaptionJob) CaptionResult {
	res := CaptionResult{ProjectID: job.ProjectID}

	if _, err := os.Stat(job.DestPath); err == nil {
		res.ASSPath = job.DestPath
		return res
	}

	var allWords []caption.WordTimestamp
	for _, ref := range job.SceneAudio {
		words, err := w.transcriber.Transcribe(ctx, ref.AudioPath)
		if err != nil {
			res.Error = fmt.Sprintf("transcribe %s: %v", ref.AudioPath, err)
			return res
		}
		for _, wd := range words {
			allWords = append(allWords, caption.WordTimestamp{
				Word:  wd.Word,
				Start: wd.Start + ref.StartOffsetSec,
				End:   wd.End + ref.StartOffsetSec,
			})
		}
	}

	if err := w.writer.Write(allWords, job.Style, job.DestPath); err != nil {
		res.Error = err.Error()
		return res
	}
	res.ASSPath = job.DestPath
	return res
}

// RenderWorker executes render jobs via the injected renderer.
type RenderWorker struct {
	bus      *bus.Bus
	renderer render.Renderer
}

func NewRenderWorker(b *bus.Bus, renderer render.Renderer) *RenderWorker {
	return &RenderWorker{bus: b, renderer: renderer}
}

func (w *RenderWorker) Start(ctx context.Context) (bus.StopFunc, error) {
	return bus.ConsumeJSON(ctx, w.bus, bus.StreamJobs, "render-worker", "vidgen.job.render.>",
		func(ctx context.Context, subject string, job RenderJob) error {
			res := w.handle(ctx, job)
			return bus.PublishJSON(ctx, w.bus, bus.ResultSubject(bus.KindRender, job.ProjectID, 0), res)
		})
}

func (w *RenderWorker) handle(ctx context.Context, job RenderJob) RenderResult {
	res := RenderResult{ProjectID: job.ProjectID}

	if _, err := os.Stat(job.OutputPath); err == nil {
		res.OutputPath = job.OutputPath
		return res
	}

	out, err := w.renderer.Render(ctx, render.RenderRequest{
		Scenes:     job.Scenes,
		ASSPath:    job.ASSPath,
		OutputPath: job.OutputPath,
	})
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.OutputPath = out.OutputPath
	res.DurationSec = out.DurationSec
	res.FileSizeBytes = out.FileSizeBytes
	return res
}
