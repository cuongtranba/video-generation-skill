package caption

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWordsSidecarPath(t *testing.T) {
	got := WordsSidecarPath("/app/media/p1/tts3.mp3")
	want := "/app/media/p1/tts3.words.json"
	if got != want {
		t.Errorf("WordsSidecarPath = %q, want %q", got, want)
	}
}

func TestSidecarReaderReadsWords(t *testing.T) {
	dir := t.TempDir()
	audio := filepath.Join(dir, "tts0.mp3")
	if err := os.WriteFile(WordsSidecarPath(audio),
		[]byte(`{"words":[{"word":"Xin","start":0,"end":0.3},{"word":"chào","start":0.3,"end":0.7}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	words, err := NewSidecarReader().Transcribe(context.Background(), audio)
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if len(words) != 2 || words[0].Word != "Xin" || words[1].End != 0.7 {
		t.Fatalf("unexpected words: %+v", words)
	}
}

func TestSidecarReaderMissingFileErrors(t *testing.T) {
	dir := t.TempDir()
	_, err := NewSidecarReader().Transcribe(context.Background(), filepath.Join(dir, "tts0.mp3"))
	if err == nil {
		t.Fatal("expected error for missing sidecar, got nil")
	}
}
