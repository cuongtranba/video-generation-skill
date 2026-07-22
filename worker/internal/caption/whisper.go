package caption

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// WhisperRunner drives the openai-whisper CLI to get word-level timestamps.
type WhisperRunner struct {
	bin string
}

func NewWhisperRunner(bin string) *WhisperRunner {
	return &WhisperRunner{bin: bin}
}

type whisperWord struct {
	Word  string  `json:"word"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

type whisperSegment struct {
	Words []whisperWord `json:"words"`
}

type whisperOutput struct {
	Segments []whisperSegment `json:"segments"`
}

func (w *WhisperRunner) Transcribe(ctx context.Context, audioPath string) ([]WordTimestamp, error) {
	outDir, err := os.MkdirTemp("", "vidgen-whisper-*")
	if err != nil {
		return nil, fmt.Errorf("create whisper output dir: %w", err)
	}
	defer os.RemoveAll(outDir)

	cmd := exec.CommandContext(ctx, w.bin,
		audioPath,
		// No --language: whisper auto-detects, so captions time correctly for
		// any narration language. Text is discarded (caption content is the
		// authoritative narration), only timings are used.
		"--word_timestamps", "True",
		"--output_format", "json",
		"--output_dir", outDir,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("run whisper on %s: %w (output: %s)", audioPath, err, truncate(string(out), 300))
	}

	base := strings.TrimSuffix(filepath.Base(audioPath), filepath.Ext(audioPath))
	jsonPath := filepath.Join(outDir, base+".json")
	data, err := os.ReadFile(jsonPath)
	if err != nil {
		return nil, fmt.Errorf("read whisper output %s: %w", jsonPath, err)
	}

	var parsed whisperOutput
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("parse whisper output %s: %w", jsonPath, err)
	}

	var words []WordTimestamp
	for _, seg := range parsed.Segments {
		for _, wd := range seg.Words {
			word := strings.TrimSpace(wd.Word)
			if word == "" {
				continue
			}
			words = append(words, WordTimestamp{Word: word, Start: wd.Start, End: wd.End})
		}
	}
	if len(words) == 0 {
		return nil, fmt.Errorf("whisper produced no word timestamps for %s", audioPath)
	}
	return words, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
