package tts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

func TestElevenLabsSynthesizeSuccess(t *testing.T) {
	var gotVoicePath, gotAPIKey string
	var gotBody elevenLabsRequest
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
	defer srv.Close()

	dir := t.TempDir()
	dest := filepath.Join(dir, "scene-0.mp3")

	p := NewElevenLabsProvider("test-key",
		WithElevenLabsBaseURL(srv.URL),
		WithElevenLabsHTTPClient(srv.Client()),
		WithElevenLabsVoiceID("VOICE123"),
		WithElevenLabsDurationProbe(func(ctx context.Context, path string) (float64, error) {
			return 4.2, nil
		}),
	)

	res, err := p.Synthesize(context.Background(), SynthesizeRequest{
		Text:  "xin chào thế giới",
		Voice: domain.Voice("lannhi"),
		Speed: domain.Speed(1),
	}, dest)
	if err != nil {
		t.Fatalf("Synthesize: %v", err)
	}

	if gotAPIKey != "test-key" {
		t.Errorf("xi-api-key = %q, want test-key", gotAPIKey)
	}
	if !strings.Contains(gotVoicePath, "VOICE123") {
		t.Errorf("request path %q should carry the voice id", gotVoicePath)
	}
	if gotBody.ModelID != elevenLabsDefaultModel {
		t.Errorf("model_id = %q, want %q", gotBody.ModelID, elevenLabsDefaultModel)
	}
	if gotBody.Text != "xin chào thế giới" {
		t.Errorf("text = %q, want the narration", gotBody.Text)
	}
	if res.AudioPath != dest {
		t.Errorf("AudioPath = %q, want %q", res.AudioPath, dest)
	}
	if res.DurationSec != 4.2 {
		t.Errorf("DurationSec = %v, want 4.2", res.DurationSec)
	}
	// "xin chào thế giới" is 17 runes (diacritics count as one each).
	if res.CharsCharged != len([]rune("xin chào thế giới")) {
		t.Errorf("CharsCharged = %d, want %d", res.CharsCharged, len([]rune("xin chào thế giới")))
	}
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
}

func TestElevenLabsSynthesizeNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":"invalid api key"}`))
	}))
	defer srv.Close()

	p := NewElevenLabsProvider("bad-key",
		WithElevenLabsBaseURL(srv.URL),
		WithElevenLabsHTTPClient(srv.Client()),
	)

	_, err := p.Synthesize(context.Background(), SynthesizeRequest{
		Text:  "xin chào",
		Voice: domain.Voice("lannhi"),
		Speed: domain.Speed(0),
	}, filepath.Join(t.TempDir(), "out.mp3"))
	if err == nil {
		t.Fatal("Synthesize: want error on non-200, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention status 401: %v", err)
	}
}
