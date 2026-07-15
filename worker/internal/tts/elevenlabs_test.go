package tts

import (
	"context"
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
		w.Header().Set("Content-Type", "audio/mpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ID3-fake-mp3-bytes"))
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
	data, _ := os.ReadFile(dest)
	if string(data) != "ID3-fake-mp3-bytes" {
		t.Errorf("written audio = %q, want the response bytes", string(data))
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
