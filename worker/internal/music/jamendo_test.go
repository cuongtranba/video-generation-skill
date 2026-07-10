package music

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func newFakeJamendo(t *testing.T, empty bool) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v3.0/tracks/":
			if r.URL.Query().Get("client_id") == "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if empty {
				_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"results": []map[string]any{
					{
						"id":            "168",
						"name":          "Morning Coffee",
						"artist_name":   "SomeArtist",
						"duration":      145,
						"audiodownload": srv.URL + "/dl/168.mp3",
						"audio":         srv.URL + "/stream/168.mp3",
					},
				},
			})
		case "/dl/168.mp3":
			_, _ = w.Write([]byte("mp3-bytes"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestJamendoSearch(t *testing.T) {
	srv := newFakeJamendo(t, false)
	src := NewJamendoSource("cid-123", WithJamendoBaseURL(srv.URL))

	tracks, err := src.Search(context.Background(), Query{Tags: "upbeat", Limit: 3})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(tracks) != 1 {
		t.Fatalf("tracks = %d, want 1", len(tracks))
	}
	tr := tracks[0]
	if tr.Name != "Morning Coffee" || tr.Artist != "SomeArtist" || tr.DurationSec != 145 {
		t.Errorf("track = %+v", tr)
	}
	if tr.DownloadURL == "" {
		t.Error("missing download url")
	}
}

func TestJamendoSearchEmpty(t *testing.T) {
	srv := newFakeJamendo(t, true)
	src := NewJamendoSource("cid-123", WithJamendoBaseURL(srv.URL))

	tracks, err := src.Search(context.Background(), Query{Tags: "nothingmatches"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(tracks) != 0 {
		t.Errorf("tracks = %d, want 0", len(tracks))
	}
}

func TestJamendoDownload(t *testing.T) {
	srv := newFakeJamendo(t, false)
	src := NewJamendoSource("cid-123", WithJamendoBaseURL(srv.URL))

	tracks, err := src.Search(context.Background(), Query{Tags: "upbeat"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}

	dest := filepath.Join(t.TempDir(), "bgm.mp3")
	if err := src.Download(context.Background(), tracks[0], dest); err != nil {
		t.Fatalf("Download: %v", err)
	}
	data, _ := os.ReadFile(dest)
	if string(data) != "mp3-bytes" {
		t.Errorf("downloaded = %q", data)
	}
}

func TestJamendoMissingClientID(t *testing.T) {
	src := NewJamendoSource("")
	if _, err := src.Search(context.Background(), Query{Tags: "x"}); err == nil {
		t.Fatal("want error for missing client id")
	}
}
