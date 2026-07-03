package flow

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/cuongtranba/video-generation-skill/internal/cost"
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/material"
	"github.com/cuongtranba/video-generation-skill/internal/music"
	"github.com/cuongtranba/video-generation-skill/internal/render"
	"github.com/cuongtranba/video-generation-skill/internal/script"
	"github.com/cuongtranba/video-generation-skill/internal/tts"
	"github.com/cuongtranba/video-generation-skill/internal/worker"
)

const localAssetPrefix = "asset:"

// Flow orchestrates the 5-step project lifecycle.
type Flow struct {
	store       *domain.ManifestStore
	script      script.Generator
	local       *material.LocalSource
	stock       material.MaterialSource
	tts         tts.TTSProvider
	probe       tts.DurationProbe
	transcriber worker.Transcriber
	renderer    render.Renderer
	music       music.MusicSource
	estimator   *cost.Estimator
	now         func() time.Time
}

type Deps struct {
	Store       *domain.ManifestStore
	Script      script.Generator
	Local       *material.LocalSource
	Stock       material.MaterialSource
	TTS         tts.TTSProvider
	Probe       tts.DurationProbe
	Transcriber worker.Transcriber
	Renderer    render.Renderer
	Music       music.MusicSource
}

func New(deps Deps) *Flow {
	return &Flow{
		store:       deps.Store,
		script:      deps.Script,
		local:       deps.Local,
		stock:       deps.Stock,
		tts:         deps.TTS,
		probe:       deps.Probe,
		transcriber: deps.Transcriber,
		renderer:    deps.Renderer,
		music:       deps.Music,
		estimator:   cost.NewEstimator(),
		now:         time.Now,
	}
}

type DraftOptions struct {
	Idea        string
	DurationSec int
	Tone        string
	SceneCount  int
	ResourceDir string
}

// Draft is step 1: idea → scene script, new project persisted as draft.
func (f *Flow) Draft(ctx context.Context, opts DraftOptions) (*domain.Project, error) {
	if strings.TrimSpace(opts.Idea) == "" {
		return nil, fmt.Errorf("idea must not be empty")
	}
	if opts.DurationSec < 15 || opts.DurationSec > 90 {
		return nil, fmt.Errorf("duration %ds out of range 15-90", opts.DurationSec)
	}

	var inventory []script.ResourceAsset
	if opts.ResourceDir != "" {
		assets, err := f.local.Scan(ctx, opts.ResourceDir)
		if err != nil {
			return nil, fmt.Errorf("scan resources: %w", err)
		}
		for _, a := range assets {
			inventory = append(inventory, script.ResourceAsset{
				Path:        a.URL,
				Type:        string(a.Type),
				DurationSec: a.DurationSec,
			})
		}
	}

	res, err := f.script.Generate(ctx, script.GenerateRequest{
		Idea:              opts.Idea,
		DurationSec:       opts.DurationSec,
		Tone:              opts.Tone,
		SceneCount:        opts.SceneCount,
		ResourceInventory: inventory,
	})
	if err != nil {
		return nil, fmt.Errorf("generate script: %w", err)
	}

	id := uuid.NewString()[:8]
	p := &domain.Project{
		ID:          id,
		CreatedAt:   f.now(),
		UpdatedAt:   f.now(),
		Status:      domain.StatusDraft,
		Idea:        opts.Idea,
		ResourceDir: opts.ResourceDir,
		Scenes:      res.Scenes,
		Style: domain.StyleSettings{
			Voice:       domain.VoiceBanmai,
			DurationSec: opts.DurationSec,
			Tone:        opts.Tone,
			CaptionStyle: domain.CaptionStyle{
				FontName: "Arial",
				FontSize: 64,
				Primary:  "#FFFFFF",
				Outline:  "#000000",
				Bold:     true,
			},
		},
		ProjectDir: f.store.ProjectDir(id),
	}

	if err := f.store.Save(p); err != nil {
		return nil, fmt.Errorf("save project: %w", err)
	}
	return p, nil
}

// Material is step 2: resolve every scene's media (user assets first, then
// stock search) and download into the project directory.
func (f *Flow) Material(ctx context.Context, p *domain.Project) error {
	if p.Status != domain.StatusDraft {
		return fmt.Errorf("project %s is %s, material step needs draft", p.ID, p.Status)
	}

	for i := range p.Scenes {
		scene := &p.Scenes[i]
		if scene.Material.LocalPath != "" {
			continue // already resolved (resume)
		}

		if assetPath, ok := strings.CutPrefix(scene.VisualNote, localAssetPrefix); ok {
			assetPath = strings.TrimSpace(assetPath)
			isImage := isImagePath(assetPath)
			ref := domain.MaterialRef{
				Type:      domain.MaterialLocal,
				SourceID:  assetPath,
				LocalPath: assetPath,
			}
			if !isImage {
				duration, err := material.DurationProbe(f.localProbe())(ctx, assetPath)
				if err != nil {
					return fmt.Errorf("probe asset for scene %d: %w", i, err)
				}
				ref.DurationSec = duration
			}
			scene.Material = ref
			continue
		}

		assets, err := f.stock.Search(ctx, material.SearchRequest{
			Query:       scene.VisualNote,
			Orientation: "portrait",
			Count:       3,
		})
		if err != nil {
			return fmt.Errorf("search material for scene %d %q: %w", i, scene.VisualNote, err)
		}
		if len(assets) == 0 {
			return fmt.Errorf("no material found for scene %d %q", i, scene.VisualNote)
		}

		asset := assets[0]
		ext := ".mp4"
		if asset.Type == material.AssetImage {
			ext = ".jpg"
		}
		dest := filepath.Join(p.ProjectDir, fmt.Sprintf("scene%d_media%s", i, ext))
		if err := f.stock.Download(ctx, asset, dest); err != nil {
			return fmt.Errorf("download material for scene %d: %w", i, err)
		}

		matType := domain.MaterialVideo
		if asset.Type == material.AssetImage {
			matType = domain.MaterialImage
		}
		scene.Material = domain.MaterialRef{
			Type:        matType,
			SourceID:    asset.Source + ":" + asset.ID,
			LocalPath:   dest,
			DurationSec: asset.DurationSec,
		}
	}

	p.Status = domain.StatusMaterial
	p.UpdatedAt = f.now()
	if err := f.store.Save(p); err != nil {
		return fmt.Errorf("save project: %w", err)
	}
	return nil
}

type TuneOptions struct {
	Voice       domain.Voice
	Speed       *domain.Speed
	FontName    string
	FontSize    int
	MusicPath   string
	MusicSearch string // Jamendo fuzzy tags; downloads the top result
	MusicVolume float64
}

// Tune is step 3: adjust voice and caption style.
func (f *Flow) Tune(ctx context.Context, p *domain.Project, opts TuneOptions) error {
	if p.Status != domain.StatusMaterial && p.Status != domain.StatusTuned {
		return fmt.Errorf("project %s is %s, tune step needs material", p.ID, p.Status)
	}

	if opts.Voice != "" {
		if !opts.Voice.Valid() {
			return fmt.Errorf("invalid voice %q (valid: %v)", opts.Voice, domain.AllVoices())
		}
		p.Style.Voice = opts.Voice
	}
	if opts.Speed != nil {
		if !opts.Speed.Valid() {
			return fmt.Errorf("invalid speed %d, must be -3..3", *opts.Speed)
		}
		p.Style.Speed = *opts.Speed
	}
	if opts.FontName != "" {
		p.Style.CaptionStyle.FontName = opts.FontName
	}
	if opts.FontSize > 0 {
		p.Style.CaptionStyle.FontSize = opts.FontSize
	}
	if opts.MusicPath != "" && opts.MusicSearch != "" {
		return fmt.Errorf("use either --music or --music-search, not both")
	}
	if opts.MusicPath != "" {
		if _, err := os.Stat(opts.MusicPath); err != nil {
			return fmt.Errorf("music file %s: %w", opts.MusicPath, err)
		}
		p.Style.MusicPath = opts.MusicPath
	}
	if opts.MusicSearch != "" {
		if f.music == nil {
			return fmt.Errorf("music search unavailable: no music source configured")
		}
		tracks, err := f.music.Search(ctx, music.Query{Tags: opts.MusicSearch, Limit: 5})
		if err != nil {
			return fmt.Errorf("search music %q: %w", opts.MusicSearch, err)
		}
		if len(tracks) == 0 {
			return fmt.Errorf("no music found for %q", opts.MusicSearch)
		}
		track := tracks[0]
		dest := filepath.Join(p.ProjectDir, "music.mp3")
		if err := f.music.Download(ctx, track, dest); err != nil {
			return fmt.Errorf("download music track %s: %w", track.ID, err)
		}
		p.Style.MusicPath = dest
		p.Style.MusicTrack = fmt.Sprintf("%s — %s (Jamendo %s)", track.Artist, track.Name, track.ID)
	}
	if opts.MusicVolume > 0 {
		if opts.MusicVolume > 1 {
			return fmt.Errorf("music volume %.2f out of range 0-1", opts.MusicVolume)
		}
		p.Style.MusicVolume = opts.MusicVolume
	}

	p.Status = domain.StatusTuned
	p.UpdatedAt = f.now()
	if err := f.store.Save(p); err != nil {
		return fmt.Errorf("save project: %w", err)
	}
	return nil
}

// Confirm is step 4: project the cost, enforce the admissibility cap, and
// freeze the projection into the manifest.
func (f *Flow) Confirm(ctx context.Context, p *domain.Project) (*cost.Ledger, error) {
	if p.Status != domain.StatusTuned {
		return nil, fmt.Errorf("project %s is %s, confirm step needs tuned", p.ID, p.Status)
	}

	ledger := cost.NewLedger()
	for _, item := range f.estimator.EstimateProject(p.Scenes) {
		ledger.AddProjected(item)
	}
	if err := ledger.CheckProjected(); err != nil {
		return ledger, fmt.Errorf("admissibility check for project %s: %w", p.ID, err)
	}

	p.CostLedger = ledger.Snapshot()
	p.Status = domain.StatusConfirmed
	p.UpdatedAt = f.now()
	if err := f.store.Save(p); err != nil {
		return ledger, fmt.Errorf("save project: %w", err)
	}
	return ledger, nil
}

// isImagePath mirrors worker.isImagePath for flow-side asset resolution.
func isImagePath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	}
	return false
}

func (f *Flow) localProbe() material.DurationProbe {
	return func(ctx context.Context, path string) (float64, error) {
		return f.probe(ctx, path)
	}
}

func captionPath(p *domain.Project) string {
	return filepath.Join(p.ProjectDir, "captions.ass")
}
