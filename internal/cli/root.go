package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/cuongtranba/video-generation-skill/internal/caption"
	"github.com/cuongtranba/video-generation-skill/internal/config"
	"github.com/cuongtranba/video-generation-skill/internal/cost"
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/flow"
	"github.com/cuongtranba/video-generation-skill/internal/material"
	"github.com/cuongtranba/video-generation-skill/internal/prereq"
	"github.com/cuongtranba/video-generation-skill/internal/render"
	"github.com/cuongtranba/video-generation-skill/internal/script"
	"github.com/cuongtranba/video-generation-skill/internal/tts"
)

type app struct {
	baseDir string
	store   *domain.ManifestStore
	flow    *flow.Flow
	cfg     config.Config
}

func defaultBaseDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".vidgen/projects"
	}
	return filepath.Join(home, ".vidgen", "projects")
}

func (a *app) init(baseDir string) error {
	checker := prereq.NewChecker()
	if err := checker.Check(); err != nil {
		return fmt.Errorf("missing prerequisites:\n%w", err)
	}

	ffmpegBin, err := checker.Resolve("ffmpeg")
	if err != nil {
		return err
	}
	ffprobeBin, err := checker.Resolve("ffprobe")
	if err != nil {
		return err
	}
	whisperBin, err := checker.Resolve("whisper")
	if err != nil {
		return err
	}
	claudeBin, err := checker.Resolve("claude")
	if err != nil {
		return err
	}

	cfg, err := config.Load(".env")
	if err != nil {
		return err
	}
	if err := cfg.ValidateForGenerate(); err != nil {
		return err
	}
	a.cfg = cfg

	a.baseDir = baseDir
	a.store = domain.NewManifestStore(baseDir)

	probe := tts.FFProbeDuration(ffprobeBin)
	stock := material.NewChain(
		material.NewPexelsSource(cfg.PexelsAPIKey),
		material.NewPixabaySource(cfg.PixabayAPIKey),
	)

	a.flow = flow.New(flow.Deps{
		Store:  a.store,
		Script: script.NewClaudeCLIGenerator(claudeBin),
		Local:       material.NewLocalSource(material.DurationProbe(probe)),
		Stock:       stock,
		TTS:         tts.NewFPTAIProvider(cfg.FPTTTSAPIKey),
		Probe:       probe,
		Transcriber: caption.NewWhisperRunner(whisperBin),
		Renderer:    render.NewFFmpegRenderer(ffmpegBin, ffprobeBin),
	})
	return nil
}

func (a *app) loadProject(projectID string) (*domain.Project, error) {
	if projectID == "" {
		return nil, fmt.Errorf("--project is required")
	}
	p, err := a.store.Load(projectID)
	if err != nil {
		return nil, err
	}
	return p, nil
}

func NewRootCmd() *cobra.Command {
	a := &app{}
	var baseDir string

	root := &cobra.Command{
		Use:           "vidgen",
		Short:         "Generate Vietnamese-voiced short-form vertical videos",
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			return a.init(baseDir)
		},
	}
	root.PersistentFlags().StringVar(&baseDir, "dir", defaultBaseDir(), "projects base directory")

	root.AddCommand(
		newNewCmd(a),
		newMaterialCmd(a),
		newTuneCmd(a),
		newConfirmCmd(a),
		newGenerateCmd(a),
		newListCmd(a),
	)
	return root
}

func newNewCmd(a *app) *cobra.Command {
	var duration, sceneCount int
	var tone, resourceDir string

	cmd := &cobra.Command{
		Use:   "new <idea>",
		Short: "Step 1: draft a scene script from an idea",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.flow.Draft(cmd.Context(), flow.DraftOptions{
				Idea:        args[0],
				DurationSec: duration,
				Tone:        tone,
				SceneCount:  sceneCount,
				ResourceDir: resourceDir,
			})
			if err != nil {
				return err
			}

			fmt.Printf("Project %s created (%d scenes)\n\n", p.ID, len(p.Scenes))
			for _, s := range p.Scenes {
				fmt.Printf("Scene %d: %s\n  visual: %s\n", s.Index+1, s.Narration, s.VisualNote)
			}
			fmt.Printf("\nNext: vidgen material --project %s\n", p.ID)
			return nil
		},
	}
	cmd.Flags().IntVar(&duration, "duration", 45, "target duration in seconds (15-90)")
	cmd.Flags().IntVar(&sceneCount, "scenes", 0, "scene count (0 = auto)")
	cmd.Flags().StringVar(&tone, "tone", "casual", "narration tone")
	cmd.Flags().StringVar(&resourceDir, "resource", "", "directory of user-provided media assets")
	return cmd
}

func newMaterialCmd(a *app) *cobra.Command {
	var projectID string
	cmd := &cobra.Command{
		Use:   "material",
		Short: "Step 2: fetch media for every scene",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return err
			}
			if err := a.flow.Material(cmd.Context(), p); err != nil {
				return err
			}
			for _, s := range p.Scenes {
				fmt.Printf("Scene %d: %s (%s)\n", s.Index+1, filepath.Base(s.Material.LocalPath), s.Material.Type)
			}
			fmt.Printf("\nNext: vidgen tune --project %s\n", p.ID)
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project ID")
	return cmd
}

func newTuneCmd(a *app) *cobra.Command {
	var projectID, voice, fontName, musicPath string
	var speed, fontSize int
	var musicVolume float64

	cmd := &cobra.Command{
		Use:   "tune",
		Short: "Step 3: adjust voice, speed, caption style, and background music",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return err
			}

			opts := flow.TuneOptions{
				Voice:       domain.Voice(voice),
				FontName:    fontName,
				FontSize:    fontSize,
				MusicPath:   musicPath,
				MusicVolume: musicVolume,
			}
			if cmd.Flags().Changed("speed") {
				s := domain.Speed(speed)
				opts.Speed = &s
			}
			if err := a.flow.Tune(cmd.Context(), p, opts); err != nil {
				return err
			}

			music := p.Style.MusicPath
			if music == "" {
				music = "(none)"
			}
			fmt.Printf("Style: voice=%s speed=%d font=%s/%d music=%s\n", p.Style.Voice, p.Style.Speed,
				p.Style.CaptionStyle.FontName, p.Style.CaptionStyle.FontSize, music)
			fmt.Printf("\nNext: vidgen confirm --project %s\n", p.ID)
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project ID")
	cmd.Flags().StringVar(&voice, "voice", "", "FPT voice: banmai thuminh lannhi linhsan leminh giahuy myan")
	cmd.Flags().IntVar(&speed, "speed", 0, "speech speed -3..3")
	cmd.Flags().StringVar(&fontName, "caption-font", "", "caption font name")
	cmd.Flags().IntVar(&fontSize, "caption-size", 0, "caption font size")
	cmd.Flags().StringVar(&musicPath, "music", "", "background music file (mp3/wav), looped and ducked under the voice")
	cmd.Flags().Float64Var(&musicVolume, "music-volume", 0, "background music volume 0-1 (default 0.15)")
	return cmd
}

func newConfirmCmd(a *app) *cobra.Command {
	var projectID string
	cmd := &cobra.Command{
		Use:   "confirm",
		Short: "Step 4: review manifest and projected cost",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return err
			}

			ledger, err := a.flow.Confirm(cmd.Context(), p)
			if err != nil {
				return err
			}

			var chars int
			for _, s := range p.Scenes {
				chars += len([]rune(s.Narration))
			}
			fmt.Printf("Scenes: %d  Voice: %s  Total narration: %d chars\n", len(p.Scenes), p.Style.Voice, chars)
			fmt.Printf("Projected cost: $%.4f (cap $%.2f) — OK\n", ledger.ProjectedTotal(), cost.CapUSD)
			fmt.Printf("\nNext: vidgen generate --project %s\n", p.ID)
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project ID")
	return cmd
}

func newGenerateCmd(a *app) *cobra.Command {
	var projectID, output string
	cmd := &cobra.Command{
		Use:   "generate",
		Short: "Step 5: render the final MP4",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return err
			}

			if output == "" {
				output = filepath.Join(p.ProjectDir, "output.mp4")
			}
			if err := a.flow.Generate(cmd.Context(), p, output, func(msg string) {
				fmt.Println(msg)
			}); err != nil {
				return err
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project ID")
	cmd.Flags().StringVar(&output, "output", "", "output MP4 path (default: project dir)")
	return cmd
}

func newListCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List projects and their status",
		RunE: func(cmd *cobra.Command, args []string) error {
			projects, err := a.store.List()
			if err != nil {
				return err
			}
			if len(projects) == 0 {
				fmt.Println("No projects yet. Start with: vidgen new \"your idea\"")
				return nil
			}
			for _, p := range projects {
				idea := p.Idea
				if len(idea) > 50 {
					idea = idea[:50] + "..."
				}
				fmt.Printf("%s  %-10s  %s\n", p.ID, p.Status, strings.TrimSpace(idea))
			}
			return nil
		},
	}
}
