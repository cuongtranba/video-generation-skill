package caption

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// whisper CLI writes <audio-basename>.json into --output_dir with segments
// containing word-level entries when --word_timestamps True.
const fakeWhisperJSON = `{
  "text": "Xin chào Việt Nam",
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 2.5,
      "text": "Xin chào Việt Nam",
      "words": [
        {"word": " Xin", "start": 0.0, "end": 0.4},
        {"word": " chào", "start": 0.4, "end": 0.9},
        {"word": " Việt", "start": 1.0, "end": 1.5},
        {"word": " Nam", "start": 1.5, "end": 2.0}
      ]
    }
  ],
  "language": "vi"
}`

func writeFakeWhisper(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	bin := filepath.Join(dir, "whisper")
	// fake whisper: finds --output_dir arg, writes <audio-base>.json there
	script := `#!/bin/sh
outdir=""
audio=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output_dir" ]; then outdir="$arg"; fi
  case "$arg" in
    -*) ;;
    *) if [ -z "$audio" ] && [ "$prev" != "--output_dir" ] && [ "$prev" != "--model" ] && [ "$prev" != "--language" ] && [ "$prev" != "--output_format" ]; then audio="$arg"; fi ;;
  esac
  prev="$arg"
done
base=$(basename "$audio")
base="${base%.*}"
cat > "$outdir/$base.json" <<'WHISPER_EOF'
` + fakeWhisperJSON + `
WHISPER_EOF
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake whisper: %v", err)
	}
	return bin
}

func TestTranscribeParsesWords(t *testing.T) {
	bin := writeFakeWhisper(t)
	audio := filepath.Join(t.TempDir(), "scene0.mp3")
	if err := os.WriteFile(audio, []byte("fake"), 0o644); err != nil {
		t.Fatalf("write audio: %v", err)
	}

	w := NewWhisperRunner(bin)
	words, err := w.Transcribe(context.Background(), audio)
	if err != nil {
		t.Fatalf("Transcribe: %v", err)
	}
	if len(words) != 4 {
		t.Fatalf("words = %d, want 4", len(words))
	}
	if words[0].Word != "Xin" || words[0].Start != 0.0 || words[0].End != 0.4 {
		t.Errorf("word[0] = %+v", words[0])
	}
	if words[3].Word != "Nam" {
		t.Errorf("word[3] = %+v", words[3])
	}
}

func TestTranscribeMissingBinary(t *testing.T) {
	w := NewWhisperRunner("/no/such/whisper")
	_, err := w.Transcribe(context.Background(), "/tmp/a.mp3")
	if err == nil {
		t.Fatal("want error for missing binary")
	}
}
