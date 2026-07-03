package render

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

type RenderRequest struct {
	Scenes     []SceneInput
	ASSPath    string
	OutputPath string
}

type RenderResult struct {
	OutputPath    string
	DurationSec   float64
	FileSizeBytes int64
}

type Renderer interface {
	Render(ctx context.Context, req RenderRequest) (RenderResult, error)
}

var _ Renderer = (*FFmpegRenderer)(nil)

type FFmpegRenderer struct {
	ffmpegBin  string
	ffprobeBin string
	builder    *FilterGraphBuilder
}

func NewFFmpegRenderer(ffmpegBin, ffprobeBin string) *FFmpegRenderer {
	return &FFmpegRenderer{
		ffmpegBin:  ffmpegBin,
		ffprobeBin: ffprobeBin,
		builder:    NewFilterGraphBuilder(),
	}
}

func (r *FFmpegRenderer) Render(ctx context.Context, req RenderRequest) (RenderResult, error) {
	graph, err := r.builder.Build(req.Scenes, req.ASSPath)
	if err != nil {
		return RenderResult{}, fmt.Errorf("build filter graph: %w", err)
	}

	args := []string{"-y", "-hide_banner", "-loglevel", "error"}
	args = append(args, graph.InputArgs...)
	args = append(args, "-filter_complex", graph.FilterComplex)
	for _, m := range graph.OutputMaps {
		args = append(args, "-map", m)
	}
	args = append(args,
		"-c:v", "libx264",
		"-preset", "fast",
		"-crf", "23",
		"-c:a", "aac",
		"-b:a", "128k",
		"-movflags", "+faststart",
		"-pix_fmt", "yuv420p",
		req.OutputPath,
	)

	cmd := exec.CommandContext(ctx, r.ffmpegBin, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return RenderResult{}, fmt.Errorf("ffmpeg render to %s: %w (output: %s)", req.OutputPath, err, truncate(string(out), 500))
	}

	info, err := os.Stat(req.OutputPath)
	if err != nil {
		return RenderResult{}, fmt.Errorf("stat rendered file %s: %w", req.OutputPath, err)
	}

	duration, err := r.probeDuration(ctx, req.OutputPath)
	if err != nil {
		return RenderResult{}, err
	}

	return RenderResult{
		OutputPath:    req.OutputPath,
		DurationSec:   duration,
		FileSizeBytes: info.Size(),
	}, nil
}

func (r *FFmpegRenderer) probeDuration(ctx context.Context, path string) (float64, error) {
	out, err := exec.CommandContext(ctx, r.ffprobeBin,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		path,
	).Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe %s: %w", path, err)
	}
	duration, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0, fmt.Errorf("parse ffprobe duration %q: %w", strings.TrimSpace(string(out)), err)
	}
	return duration, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
