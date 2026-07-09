package publish

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
)

func writeTempVideo(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "out.mp4")
	if err := os.WriteFile(path, []byte("fake-mp4-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// newFakeTikTok simulates init -> upload -> status(complete after n polls).
func newFakeTikTok(t *testing.T, notCompletePolls int32) *httptest.Server {
	t.Helper()
	var polls atomic.Int32
	mux := http.NewServeMux()
	var srv *httptest.Server

	mux.HandleFunc("POST /v2/post/publish/video/init/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"publish_id": "pub-1",
				"upload_url": srv.URL + "/upload/pub-1",
			},
			"error": map[string]any{"code": "ok"},
		})
	})
	mux.HandleFunc("PUT /upload/pub-1", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	mux.HandleFunc("POST /v2/post/publish/status/fetch/", func(w http.ResponseWriter, r *http.Request) {
		status := "PUBLISH_COMPLETE"
		if polls.Add(1) <= notCompletePolls {
			status = "PROCESSING_UPLOAD"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data":  map[string]any{"status": status},
			"error": map[string]any{"code": "ok"},
		})
	})

	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func newTestPublisher(url string) *TikTokPublisher {
	return NewTikTokPublisher("test-token",
		WithBaseURL(url),
		WithPollInterval(10*time.Millisecond),
		WithPollTimeout(2*time.Second),
	)
}

func TestPublishSuccess(t *testing.T) {
	srv := newFakeTikTok(t, 1) // complete on 2nd poll
	p := newTestPublisher(srv.URL)

	res, err := p.Publish(context.Background(), PublishRequest{
		VideoPath: writeTempVideo(t),
		Caption:   "hello",
		Privacy:   "private",
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if res.PublishID != "pub-1" {
		t.Errorf("PublishID = %q, want pub-1", res.PublishID)
	}
}

func TestPublishUnauthorized(t *testing.T) {
	srv := newFakeTikTok(t, 0)
	p := newTestPublisher(srv.URL)
	p.accessToken = "" // force missing auth

	_, err := p.Publish(context.Background(), PublishRequest{VideoPath: writeTempVideo(t)})
	if err == nil {
		t.Fatal("want error for missing auth token")
	}
}

func TestPublishMissingFile(t *testing.T) {
	srv := newFakeTikTok(t, 0)
	p := newTestPublisher(srv.URL)
	if _, err := p.Publish(context.Background(), PublishRequest{VideoPath: "/no/such.mp4"}); err == nil {
		t.Fatal("want error for missing video file")
	}
}
