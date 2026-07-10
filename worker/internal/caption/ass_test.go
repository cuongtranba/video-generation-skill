package caption

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

func TestASSWriterProducesKaraoke(t *testing.T) {
	words := []WordTimestamp{
		{Word: "Xin", Start: 0.0, End: 0.4},
		{Word: "chào", Start: 0.4, End: 0.9},
		{Word: "Việt", Start: 1.0, End: 1.5},
		{Word: "Nam", Start: 1.5, End: 2.0},
	}
	style := domain.CaptionStyle{
		FontName: "Arial",
		FontSize: 36,
		Primary:  "#FFFFFF",
		Outline:  "#000000",
		Bold:     true,
	}

	dest := filepath.Join(t.TempDir(), "captions.ass")
	if err := NewASSWriter().Write(words, style, dest); err != nil {
		t.Fatalf("Write: %v", err)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	content := string(data)

	for _, want := range []string{
		"[Script Info]",
		"PlayResX: 1080",
		"PlayResY: 1920",
		"[V4+ Styles]",
		"Arial",
		"[Events]",
		"Dialogue:",
		`\k`, // karaoke tags
		"Xin", "chào", "Việt", "Nam",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("ASS missing %q", want)
		}
	}
}

func TestASSWriterEmptyWords(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "captions.ass")
	err := NewASSWriter().Write(nil, domain.CaptionStyle{}, dest)
	if err == nil {
		t.Fatal("want error for empty words")
	}
}

func TestGroupWordsIntoLines(t *testing.T) {
	words := make([]WordTimestamp, 12)
	for i := range words {
		words[i] = WordTimestamp{Word: "từ", Start: float64(i), End: float64(i) + 0.5}
	}
	lines := groupWords(words, 4)
	if len(lines) != 3 {
		t.Fatalf("lines = %d, want 3", len(lines))
	}
	for _, line := range lines {
		if len(line) != 4 {
			t.Errorf("line len = %d, want 4", len(line))
		}
	}
}

func TestASSTimeFormat(t *testing.T) {
	tests := []struct {
		sec  float64
		want string
	}{
		{0, "0:00:00.00"},
		{1.5, "0:00:01.50"},
		{61.25, "0:01:01.25"},
		{3600.99, "1:00:00.99"},
	}
	for _, tt := range tests {
		if got := assTime(tt.sec); got != tt.want {
			t.Errorf("assTime(%v) = %q, want %q", tt.sec, got, tt.want)
		}
	}
}
