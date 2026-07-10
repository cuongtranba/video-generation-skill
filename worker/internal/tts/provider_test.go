package tts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

const fakeMP3 = "ID3\x04fake-mp3-bytes"

// newFakeFPT returns a server simulating the FPT.AI v5 API: POST returns an
// async link; the mp3 URL 404s for the first n polls, then serves content.
func newFakeFPT(t *testing.T, notReadyPolls int32) *httptest.Server {
	t.Helper()
	var polls atomic.Int32
	mux := http.NewServeMux()
	var srv *httptest.Server

	mux.HandleFunc("POST /hmi/tts/v5", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("api-key") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"message": "You cannot consume this service"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"async":      srv.URL + "/audio/out.mp3",
			"error":      0,
			"request_id": "req-1",
		})
	})
	mux.HandleFunc("GET /audio/out.mp3", func(w http.ResponseWriter, r *http.Request) {
		if polls.Add(1) <= notReadyPolls {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(fakeMP3))
	})

	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func newTestProvider(url string) *FPTAIProvider {
	return NewFPTAIProvider("test-key",
		WithEndpoint(url+"/hmi/tts/v5"),
		WithPollInterval(10*time.Millisecond),
		WithPollTimeout(2*time.Second),
		WithDurationProbe(func(ctx context.Context, path string) (float64, error) { return 4.2, nil }),
	)
}

func TestSynthesizeSuccess(t *testing.T) {
	srv := newFakeFPT(t, 2) // ready on 3rd poll
	p := newTestProvider(srv.URL)

	dest := filepath.Join(t.TempDir(), "scene0.mp3")
	res, err := p.Synthesize(context.Background(), SynthesizeRequest{
		Text:  "Xin chào Việt Nam",
		Voice: domain.VoiceBanmai,
		Speed: 0,
	}, dest)
	if err != nil {
		t.Fatalf("Synthesize: %v", err)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if string(data) != fakeMP3 {
		t.Errorf("output bytes = %q", data)
	}
	if res.AudioPath != dest {
		t.Errorf("AudioPath = %q, want %q", res.AudioPath, dest)
	}
	if res.DurationSec != 4.2 {
		t.Errorf("DurationSec = %v, want 4.2", res.DurationSec)
	}
	wantChars := len([]rune("Xin chào Việt Nam"))
	if res.CharsCharged != wantChars {
		t.Errorf("CharsCharged = %d, want %d", res.CharsCharged, wantChars)
	}
}

func TestSynthesizePollTimeout(t *testing.T) {
	srv := newFakeFPT(t, 10_000) // never ready
	p := NewFPTAIProvider("test-key",
		WithEndpoint(srv.URL+"/hmi/tts/v5"),
		WithPollInterval(10*time.Millisecond),
		WithPollTimeout(50*time.Millisecond),
		WithDurationProbe(func(ctx context.Context, path string) (float64, error) { return 0, nil }),
	)

	_, err := p.Synthesize(context.Background(), SynthesizeRequest{
		Text: "abc", Voice: domain.VoiceBanmai,
	}, filepath.Join(t.TempDir(), "out.mp3"))
	if err == nil {
		t.Fatal("want timeout error")
	}
}

func TestSynthesizeAPIError(t *testing.T) {
	srv := newFakeFPT(t, 0)
	p := NewFPTAIProvider("", // empty key → 401 from fake
		WithEndpoint(srv.URL+"/hmi/tts/v5"),
		WithPollInterval(10*time.Millisecond),
		WithPollTimeout(time.Second),
	)

	_, err := p.Synthesize(context.Background(), SynthesizeRequest{
		Text: "abc", Voice: domain.VoiceBanmai,
	}, filepath.Join(t.TempDir(), "out.mp3"))
	if err == nil {
		t.Fatal("want error for unauthorized request")
	}
}

func TestSynthesizeValidation(t *testing.T) {
	p := NewFPTAIProvider("key")
	tests := []struct {
		name string
		req  SynthesizeRequest
	}{
		{"empty text", SynthesizeRequest{Voice: domain.VoiceBanmai}},
		{"too short", SynthesizeRequest{Text: "ab", Voice: domain.VoiceBanmai}},
		{"invalid voice", SynthesizeRequest{Text: "hello world", Voice: domain.Voice("bad")}},
		{"invalid speed", SynthesizeRequest{Text: "hello world", Voice: domain.VoiceBanmai, Speed: 5}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := p.Synthesize(context.Background(), tt.req, "/tmp/x.mp3"); err == nil {
				t.Error("want validation error")
			}
		})
	}
}
