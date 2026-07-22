# ElevenLabs Timestamps Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the whisper caption transcriber with word timestamps returned by ElevenLabs' `/with-timestamps` synthesis endpoint, persisted as per-scene sidecar files.

**Architecture:** The TTS handler already synthesizes each scene's audio. Switch that call to `POST /v1/text-to-speech/{voice}/with-timestamps`, which returns base64 audio *plus* character-level timings in one call. Write the audio (unchanged path) and a sibling `tts{idx}.words.json` sidecar of word timestamps. The caption handler reads sidecars via a new `SidecarReader` that implements the existing `Transcriber` interface, so the caption handler, job/event catalogue, api, and frontend are untouched. Whisper is deleted entirely.

**Tech Stack:** Go 1.25 (worker), NATS JetStream, ffmpeg/libass, ElevenLabs HTTP API. Tests: standard `testing` + `net/http/httptest`, table-driven per Uber style.

## Global Constraints

- Go Uber style: DI via constructors, `var _ I = (*T)(nil)` interface assertions, wrap every error `fmt.Errorf("op: %w", err)`, no `any`/`interface{}` for data, table-driven tests, `httptest` for external APIs.
- Frozen event/job catalogue is unchanged: `VoiceSynthesized` and `CaptionsBuilt` payload shapes and the `CaptionJob`/`TTSJob` structs must not change.
- The `caption.Transcriber` interface (`Transcribe(ctx, audioPath) ([]caption.WordTimestamp, error)`) must not change — `SidecarReader` and the deleted `WhisperRunner` both satisfy it.
- Sidecar path convention is owned by `caption.WordsSidecarPath` — both writer (tts) and reader (caption) call it; never hand-format the path.
- Package import direction: `tts` may import `caption`; `caption` must NOT import `tts` (avoid a cycle — `caption` imports only stdlib today).
- Targeted test gates only (never full-repo builds in parallel): `cd worker && go build ./... && go vet ./... && go test ./internal/tts/... ./internal/caption/... ./internal/jobhandler/... ./internal/render/...`.
- Char count billed is runes: `len([]rune(text))` — keep the existing `minChars`/`maxChars` (3..5000) guard.

---

### Task 1: Sidecar contract + reader in the caption package

**Files:**
- Create: `worker/internal/caption/sidecar.go`
- Create: `worker/internal/caption/sidecar_test.go`
- Modify: `worker/internal/caption/align.go:1-16` (move the `WordTimestamp` type here so it survives whisper.go deletion)
- Modify: `worker/internal/caption/whisper.go:12-17` (remove the `WordTimestamp` declaration — it now lives in align.go; same package, whisper.go still compiles until Task 4 deletes it)

**Interfaces:**
- Produces:
  - `type WordTimestamp struct { Word string `json:"word"`; Start float64 `json:"start"`; End float64 `json:"end"` }` (moved into `align.go`)
  - `type WordsSidecar struct { Words []WordTimestamp `json:"words"` }`
  - `func WordsSidecarPath(audioPath string) string` — replaces the audio extension with `.words.json` (e.g. `/m/tts0.mp3` → `/m/tts0.words.json`)
  - `type SidecarReader struct{}` + `func NewSidecarReader() *SidecarReader`
  - `func (r *SidecarReader) Transcribe(ctx context.Context, audioPath string) ([]WordTimestamp, error)` — reads `WordsSidecarPath(audioPath)`, returns its words; error if missing/empty
  - `var _ Transcriber = (*SidecarReader)(nil)` will be added in Task 4 (the `Transcriber` interface lives in `jobhandler`, importing it here would invert the dependency — instead the compile-time check stays in jobhandler where the interface is defined). `SidecarReader` just needs the matching method signature.

- [ ] **Step 1: Move `WordTimestamp` into align.go**

In `worker/internal/caption/align.go`, insert the type just under `import "strings"`:

```go
package caption

import "strings"

// WordTimestamp is one caption token with its start/end time in seconds,
// relative to the audio it was derived from. The json tags match the sidecar
// file format written by the tts package.
type WordTimestamp struct {
	Word  string  `json:"word"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}
```

Then delete the now-duplicate `WordTimestamp` block from `worker/internal/caption/whisper.go` (lines 12-17). Leave the rest of whisper.go intact.

- [ ] **Step 2: Write the failing sidecar test**

Create `worker/internal/caption/sidecar_test.go`:

```go
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && go test ./internal/caption/ -run 'Sidecar|WordsSidecar' -v`
Expected: FAIL — `undefined: WordsSidecarPath` / `undefined: NewSidecarReader`.

- [ ] **Step 4: Implement sidecar.go**

Create `worker/internal/caption/sidecar.go`:

```go
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && go test ./internal/caption/ -v`
Expected: PASS (all caption tests, including the untouched whisper/align/ass suites).

- [ ] **Step 6: Commit**

```bash
git add worker/internal/caption/sidecar.go worker/internal/caption/sidecar_test.go worker/internal/caption/align.go worker/internal/caption/whisper.go
git commit -m "feat(worker): add words sidecar contract and SidecarReader transcriber"
```

---

### Task 2: `wordsFromAlignment` — char alignment → word timestamps (tts package)

**Files:**
- Create: `worker/internal/tts/alignment.go`
- Create: `worker/internal/tts/alignment_test.go`

**Interfaces:**
- Consumes: `caption.WordTimestamp` (Task 1).
- Produces:
  - `type elevenLabsAlignment struct { Characters []string `json:"characters"`; CharacterStartTimesSeconds []float64 `json:"character_start_times_seconds"`; CharacterEndTimesSeconds []float64 `json:"character_end_times_seconds"` }`
  - `func wordsFromAlignment(a *elevenLabsAlignment) []caption.WordTimestamp` — groups consecutive non-whitespace characters into words; word `Start` = first char start, `End` = last char end; whitespace separates. Returns nil for a nil/empty alignment or one with mismatched slice lengths.

- [ ] **Step 1: Write the failing test**

Create `worker/internal/tts/alignment_test.go`:

```go
package tts

import "testing"

func TestWordsFromAlignmentGroupsByWhitespace(t *testing.T) {
	a := &elevenLabsAlignment{
		Characters:                 []string{"X", "i", "n", " ", "c", "h", "à", "o"},
		CharacterStartTimesSeconds: []float64{0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7},
		CharacterEndTimesSeconds:   []float64{0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8},
	}
	got := wordsFromAlignment(a)
	if len(got) != 2 {
		t.Fatalf("want 2 words, got %d (%+v)", len(got), got)
	}
	if got[0].Word != "Xin" || got[0].Start != 0.0 || got[0].End != 0.3 {
		t.Errorf("word0 = %+v, want {Xin 0 0.3}", got[0])
	}
	if got[1].Word != "chào" || got[1].Start != 0.4 || got[1].End != 0.8 {
		t.Errorf("word1 = %+v, want {chào 0.4 0.8}", got[1])
	}
}

func TestWordsFromAlignmentHandlesRunsAndEdges(t *testing.T) {
	a := &elevenLabsAlignment{
		Characters:                 []string{" ", "a", " ", " ", "b", " "},
		CharacterStartTimesSeconds: []float64{0, 1, 2, 3, 4, 5},
		CharacterEndTimesSeconds:   []float64{1, 2, 3, 4, 5, 6},
	}
	got := wordsFromAlignment(a)
	if len(got) != 2 || got[0].Word != "a" || got[1].Word != "b" {
		t.Fatalf("want [a b], got %+v", got)
	}
	if got[0].Start != 1 || got[0].End != 2 || got[1].Start != 4 || got[1].End != 5 {
		t.Errorf("edge timings wrong: %+v", got)
	}
}

func TestWordsFromAlignmentEmptyOrMismatched(t *testing.T) {
	if got := wordsFromAlignment(nil); got != nil {
		t.Errorf("nil alignment -> %+v, want nil", got)
	}
	if got := wordsFromAlignment(&elevenLabsAlignment{}); got != nil {
		t.Errorf("empty alignment -> %+v, want nil", got)
	}
	bad := &elevenLabsAlignment{
		Characters:                 []string{"a", "b"},
		CharacterStartTimesSeconds: []float64{0},
		CharacterEndTimesSeconds:   []float64{1},
	}
	if got := wordsFromAlignment(bad); got != nil {
		t.Errorf("mismatched lengths -> %+v, want nil", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd worker && go test ./internal/tts/ -run WordsFromAlignment -v`
Expected: FAIL — `undefined: elevenLabsAlignment` / `undefined: wordsFromAlignment`.

- [ ] **Step 3: Implement alignment.go**

Create `worker/internal/tts/alignment.go`:

```go
package tts

import (
	"strings"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
)

// elevenLabsAlignment is the character-level timing block returned by the
// ElevenLabs /with-timestamps endpoint. All three slices are parallel.
type elevenLabsAlignment struct {
	Characters                 []string  `json:"characters"`
	CharacterStartTimesSeconds []float64 `json:"character_start_times_seconds"`
	CharacterEndTimesSeconds   []float64 `json:"character_end_times_seconds"`
}

// wordsFromAlignment groups consecutive non-whitespace characters into words.
// A word's start is its first character's start time and its end is its last
// character's end time; whitespace characters are separators only. Returns nil
// when the alignment is nil, empty, or has inconsistent slice lengths (the
// caller then writes no sidecar and captions fail loudly rather than drift).
func wordsFromAlignment(a *elevenLabsAlignment) []caption.WordTimestamp {
	if a == nil {
		return nil
	}
	n := len(a.Characters)
	if n == 0 || len(a.CharacterStartTimesSeconds) != n || len(a.CharacterEndTimesSeconds) != n {
		return nil
	}
	var words []caption.WordTimestamp
	var cur strings.Builder
	var start, end float64
	inWord := false
	flush := func() {
		if inWord && cur.Len() > 0 {
			words = append(words, caption.WordTimestamp{Word: cur.String(), Start: start, End: end})
		}
		cur.Reset()
		inWord = false
	}
	for i, ch := range a.Characters {
		if strings.TrimSpace(ch) == "" {
			flush()
			continue
		}
		if !inWord {
			start = a.CharacterStartTimesSeconds[i]
			inWord = true
		}
		cur.WriteString(ch)
		end = a.CharacterEndTimesSeconds[i]
	}
	flush()
	return words
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && go test ./internal/tts/ -run WordsFromAlignment -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/internal/tts/alignment.go worker/internal/tts/alignment_test.go
git commit -m "feat(worker): convert ElevenLabs char alignment to word timestamps"
```

---

### Task 3: Switch `Synthesize` to `/with-timestamps` and write the sidecar

**Files:**
- Modify: `worker/internal/tts/provider.go:22-26` (add `WordsPath` to `SynthesizeResult`)
- Modify: `worker/internal/tts/elevenlabs.go:84-160` (request `/with-timestamps`, JSON accept, decode base64 audio, write sidecar)
- Modify: `worker/internal/tts/elevenlabs_test.go:16-70` (server returns the new JSON body; assert sidecar written)

**Interfaces:**
- Consumes: `wordsFromAlignment`, `elevenLabsAlignment` (Task 2); `caption.WordsSidecar`, `caption.WordsSidecarPath` (Task 1).
- Produces: `SynthesizeResult.WordsPath string` — path of the sidecar written, or `""` when the API returned no usable alignment. `AudioPath`, `DurationSec`, `CharsCharged` unchanged.

- [ ] **Step 1: Add `WordsPath` to SynthesizeResult**

In `worker/internal/tts/provider.go`, extend the struct:

```go
type SynthesizeResult struct {
	AudioPath    string
	DurationSec  float64
	CharsCharged int
	WordsPath    string
}
```

- [ ] **Step 2: Update the test to drive the new behavior (failing)**

Replace the server stub and add sidecar assertions in `worker/internal/tts/elevenlabs_test.go`. The handler now returns JSON; encode a tiny base64 "mp3" and a two-word alignment. Add these imports if missing: `encoding/base64`. Change the `TestElevenLabsSynthesizeSuccess` server + assertions to:

```go
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotVoicePath = r.URL.Path
		gotAPIKey = r.Header.Get("xi-api-key")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		resp := map[string]any{
			"audio_base64": base64.StdEncoding.EncodeToString([]byte("ID3-fake-mp3-bytes")),
			"alignment": map[string]any{
				"characters":                    []string{"x", "i", "n", " ", "c", "h", "à", "o"},
				"character_start_times_seconds": []float64{0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7},
				"character_end_times_seconds":   []float64{0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}))
```

Then, after the existing `AudioPath`/`DurationSec` assertions, assert the request hit the timestamps path, the mp3 bytes are the decoded audio, and the sidecar exists with two words:

```go
	if !strings.Contains(gotVoicePath, "with-timestamps") {
		t.Errorf("request path %q should target /with-timestamps", gotVoicePath)
	}
	mp3, err := os.ReadFile(dest)
	if err != nil || string(mp3) != "ID3-fake-mp3-bytes" {
		t.Fatalf("mp3 at %s = %q, err %v; want decoded audio", dest, string(mp3), err)
	}
	wantSidecar := filepath.Join(dir, "scene-0.words.json")
	if res.WordsPath != wantSidecar {
		t.Errorf("WordsPath = %q, want %q", res.WordsPath, wantSidecar)
	}
	scData, err := os.ReadFile(wantSidecar)
	if err != nil {
		t.Fatalf("read sidecar: %v", err)
	}
	if !strings.Contains(string(scData), `"chào"`) {
		t.Errorf("sidecar %s missing aligned word: %s", wantSidecar, scData)
	}
```

Keep the existing rune-count assertion for `CharsCharged` (17). Verify the error-path test `TestElevenLabsSynthesize*` for non-200 still sends a JSON error body if it asserts on the message (the error format string is unchanged).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd worker && go test ./internal/tts/ -run Synthesize -v`
Expected: FAIL — audio is still written as raw body / no sidecar / `WordsPath` empty.

- [ ] **Step 4: Rewrite the Synthesize response handling**

In `worker/internal/tts/elevenlabs.go`: add `"encoding/base64"` to imports; add a response type; change the request URL/Accept and the body handling. Replace the URL line and the response-handling block (from `url := ...` down through the `os.WriteFile(destPath, audio, ...)` block) with:

```go
	url := fmt.Sprintf("%s/v1/text-to-speech/%s/with-timestamps?output_format=%s", p.baseURL, p.voiceID, p.outputFormat)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("build elevenlabs request: %w", err)
	}
	httpReq.Header.Set("xi-api-key", p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("elevenlabs tts request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return SynthesizeResult{}, fmt.Errorf("ElevenLabs TTS rejected request (status %d): %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var tsResp elevenLabsTimestampResponse
	if err := json.NewDecoder(resp.Body).Decode(&tsResp); err != nil {
		return SynthesizeResult{}, fmt.Errorf("decode elevenlabs timestamps response: %w", err)
	}
	audio, err := base64.StdEncoding.DecodeString(tsResp.AudioBase64)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("decode elevenlabs audio_base64: %w", err)
	}
	if err := os.WriteFile(destPath, audio, 0o644); err != nil {
		return SynthesizeResult{}, fmt.Errorf("write audio to %s: %w", destPath, err)
	}

	wordsPath, err := writeWordsSidecar(destPath, tsResp.alignmentWords())
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("write words sidecar for %s: %w", destPath, err)
	}
```

Then change the final `return SynthesizeResult{...}` to include `WordsPath: wordsPath`:

```go
	return SynthesizeResult{
		AudioPath:    destPath,
		DurationSec:  duration,
		CharsCharged: chars,
		WordsPath:    wordsPath,
	}, nil
```

Add the response type + helpers at the bottom of `elevenlabs.go` (or in `alignment.go`; keep them in `elevenlabs.go` so the HTTP shape lives with the client):

```go
type elevenLabsTimestampResponse struct {
	AudioBase64         string               `json:"audio_base64"`
	Alignment           *elevenLabsAlignment `json:"alignment"`
	NormalizedAlignment *elevenLabsAlignment `json:"normalized_alignment"`
}

// alignmentWords prefers the literal alignment (matches the narration text the
// caption aligner expects) and falls back to the normalized alignment.
func (r elevenLabsTimestampResponse) alignmentWords() []caption.WordTimestamp {
	if w := wordsFromAlignment(r.Alignment); len(w) > 0 {
		return w
	}
	return wordsFromAlignment(r.NormalizedAlignment)
}

// writeWordsSidecar atomically writes words next to destPath as a .words.json
// sidecar. When there are no words (API returned no usable alignment) it writes
// nothing and returns an empty path — the caption stage will then fail loudly.
func writeWordsSidecar(destPath string, words []caption.WordTimestamp) (string, error) {
	if len(words) == 0 {
		return "", nil
	}
	path := caption.WordsSidecarPath(destPath)
	data, err := json.Marshal(caption.WordsSidecar{Words: words})
	if err != nil {
		return "", fmt.Errorf("marshal words sidecar: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", fmt.Errorf("write temp sidecar %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("rename sidecar %s: %w", path, err)
	}
	return path, nil
}
```

Add the import for the caption package at the top of `elevenlabs.go`:

```go
	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd worker && go test ./internal/tts/ -v`
Expected: PASS (Synthesize success writes decoded mp3 + sidecar; alignment and error-path tests green).

- [ ] **Step 6: Commit**

```bash
git add worker/internal/tts/provider.go worker/internal/tts/elevenlabs.go worker/internal/tts/elevenlabs_test.go
git commit -m "feat(worker): synthesize via /with-timestamps and write words sidecar"
```

---

### Task 4: Wire SidecarReader, delete whisper, trim the image

**Files:**
- Modify: `worker/cmd/worker/main.go:47-50` (remove whisper binary resolution) and `:90` (use `caption.NewSidecarReader()`)
- Modify: `worker/internal/jobhandler/caption.go:14-18` (the `var _ Transcriber = (*caption.WhisperRunner)(nil)` assertion → `(*caption.SidecarReader)(nil)`)
- Delete: `worker/internal/caption/whisper.go`, `worker/internal/caption/whisper_test.go`
- Modify: `worker/Dockerfile:21-22,34` (remove `pip install openai-whisper` and `ENV WHISPER_BIN=whisper`)

**Interfaces:**
- Consumes: `caption.NewSidecarReader()` (Task 1). The `Transcriber` interface (declared in `worker/internal/jobhandler/caption.go`) is unchanged; `SidecarReader.Transcribe` matches it.

- [ ] **Step 1: Point the compile-time assertion at SidecarReader**

In `worker/internal/jobhandler/caption.go`, change:

```go
var _ Transcriber = (*caption.WhisperRunner)(nil)
```
to:
```go
var _ Transcriber = (*caption.SidecarReader)(nil)
```

- [ ] **Step 2: Rewire main.go and drop whisper resolution**

In `worker/cmd/worker/main.go`, delete the block:

```go
	whisperBin, err := checker.Resolve("whisper")
	if err != nil {
		return fmt.Errorf("resolve whisper: %w", err)
	}
```

and change the caption handler construction:

```go
	captionHandler := jobhandler.NewCaptionHandler(caption.NewSidecarReader(), caption.NewASSWriter(), store)
```

- [ ] **Step 3: Delete whisper files**

```bash
git rm worker/internal/caption/whisper.go worker/internal/caption/whisper_test.go
```

- [ ] **Step 4: Trim the Dockerfile**

In `worker/Dockerfile`, remove the line `RUN pip install --no-cache-dir openai-whisper` and the line `ENV WHISPER_BIN=whisper`. (Leave the `python:3.11-slim-bookworm` base and the ffmpeg install + libass guard as-is — a later cleanup can swap the base image; out of scope here.)

- [ ] **Step 5: Build, vet, and run targeted suites**

Run:
```bash
cd worker && go build ./... && go vet ./... && go test ./internal/tts/... ./internal/caption/... ./internal/jobhandler/... ./internal/render/...
```
Expected: build clean, vet clean, all suites PASS. (If `go vet` flags an unused `checker`/import after removing the whisper block, remove the now-dead reference — `checker` is still used for ffmpeg/ffprobe, so no import should become unused.)

- [ ] **Step 6: Commit**

```bash
git add worker/cmd/worker/main.go worker/internal/jobhandler/caption.go worker/Dockerfile
git commit -m "feat(worker): use sidecar timestamps for captions, remove whisper"
```

---

### Task 5: Docs + C3 change-unit

**Files:**
- Modify: `README.md` (pipeline/architecture description mentioning whisper)
- Modify: `CLAUDE.md` (Gotchas: replace the "Whisper transcription takes ~2-3 min" note; keep the ffmpeg/libass note)
- C3: record the whisper→sidecar swap via the `/c3` change flow

- [ ] **Step 1: Update README**

Find whisper mentions and reword to the new flow:

Run: `rg -n -i whisper README.md`
Replace the caption description so it reads that captions come from ElevenLabs `/with-timestamps` word timings (per-scene `tts{idx}.words.json` sidecars) rather than whisper transcription. Keep the render/libass description intact.

- [ ] **Step 2: Update CLAUDE.md gotchas**

Run: `rg -n -i whisper CLAUDE.md`
Replace the whisper gotcha bullet with:

```markdown
- **Captions come from ElevenLabs `/with-timestamps`**: synthesis returns word timings alongside the audio; the tts step writes a `tts{idx}.words.json` sidecar next to each mp3 and the caption handler reads it (no whisper, no CPU-bound transcription wait). `captionsReady` now lands right after the last voiceover. If a sidecar is missing (e.g. audio synthesized before this change), the caption job fails loudly rather than guessing timings — re-run voiceovers to regenerate the sidecars.
```

Keep the `ffmpeg needs libass` and `Render is gated on inputs` bullets unchanged.

- [ ] **Step 3: Commit docs**

```bash
git add README.md CLAUDE.md
git commit -m "docs: captions via ElevenLabs timestamps, drop whisper references"
```

- [ ] **Step 4: Record the C3 change-unit**

Invoke the C3 skill (`/c3`) with a change describing: the caption component (`c3-20` worker) no longer depends on the whisper CLI; word timestamps now originate from the tts step's ElevenLabs `/with-timestamps` call, persisted as `tts{idx}.words.json` sidecars and read by `caption.SidecarReader`. Follow the C3 change flow to freeze the fact; do not hand-edit `.c3/`.

---

## Verification before completion (all tasks done)

Run the verification-before-completion skill. Concretely:

1. `cd worker && go build ./... && go vet ./... && go test ./internal/tts/... ./internal/caption/... ./internal/jobhandler/... ./internal/render/...` — all green, read the output.
2. Build the worker image to confirm the trimmed Dockerfile still passes the libass guard: `docker build -f worker/Dockerfile -t vidgen-worker-test worker` (expect success; no whisper layer).
3. Live golden path on the deployed stack: drive create → script → material → GenerateVoiceovers; confirm `captionsReady` flips within seconds of the last `VoiceSynthesized` (not minutes), then approve + render and confirm `RenderCompleted` with burned captions in `output.mp4` and cost ≤ cap.

Report actual command output — no "should pass".
