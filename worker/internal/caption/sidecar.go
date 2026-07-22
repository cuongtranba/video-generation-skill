package caption

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// WordsSidecar is the on-disk word-timestamp file written next to each scene's
// mp3 by the tts package and read back by SidecarReader.
type WordsSidecar struct {
	Words []WordTimestamp `json:"words"`
}

// WordsSidecarPath maps an audio file path to its sibling word-timestamp
// sidecar (e.g. ".../tts0.mp3" -> ".../tts0.words.json"). It is the single
// source of truth for the convention shared by the writer and the reader.
func WordsSidecarPath(audioPath string) string {
	ext := ""
	if i := strings.LastIndex(audioPath, "."); i >= 0 && !strings.ContainsAny(audioPath[i:], "/\\") {
		ext = audioPath[i:]
	}
	return strings.TrimSuffix(audioPath, ext) + ".words.json"
}

// SidecarReader yields word timestamps by reading the sidecar the tts step
// wrote alongside the audio. It satisfies the caption Transcriber contract.
type SidecarReader struct{}

func NewSidecarReader() *SidecarReader {
	return &SidecarReader{}
}

func (r *SidecarReader) Transcribe(_ context.Context, audioPath string) ([]WordTimestamp, error) {
	path := WordsSidecarPath(audioPath)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read words sidecar %s: %w", path, err)
	}
	var sc WordsSidecar
	if err := json.Unmarshal(data, &sc); err != nil {
		return nil, fmt.Errorf("parse words sidecar %s: %w", path, err)
	}
	if len(sc.Words) == 0 {
		return nil, fmt.Errorf("words sidecar %s has no words", path)
	}
	return sc.Words, nil
}
