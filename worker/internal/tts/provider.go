package tts

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

const (
	maxChars = 5000
	minChars = 3
)

type SynthesizeRequest struct {
	Text  string
	Voice domain.Voice
	Speed domain.Speed
}

type SynthesizeResult struct {
	AudioPath    string
	DurationSec  float64
	CharsCharged int
	WordsPath    string
}

type TTSProvider interface {
	Synthesize(ctx context.Context, req SynthesizeRequest, destPath string) (SynthesizeResult, error)
}

// DurationProbe measures the duration of an audio file in seconds.
type DurationProbe func(ctx context.Context, path string) (float64, error)

// FFProbeDuration returns a DurationProbe backed by the ffprobe binary.
func FFProbeDuration(ffprobeBin string) DurationProbe {
	return func(ctx context.Context, path string) (float64, error) {
		out, err := exec.CommandContext(ctx, ffprobeBin,
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
}
