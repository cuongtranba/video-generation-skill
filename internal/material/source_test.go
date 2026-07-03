package material

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPexelsSearchPortraitVideos(t *testing.T) {
	var gotAuth, gotQuery, gotOrientation string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/videos/search":
			gotAuth = r.Header.Get("Authorization")
			gotQuery = r.URL.Query().Get("query")
			gotOrientation = r.URL.Query().Get("orientation")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"videos": []map[string]any{
					{
						"id":       12345,
						"duration": 12,
						"width":    1080,
						"height":   1920,
						"video_files": []map[string]any{
							{"id": 1, "quality": "sd", "width": 540, "height": 960, "link": srv.URL + "/dl/small.mp4"},
							{"id": 2, "quality": "hd", "width": 1080, "height": 1920, "link": srv.URL + "/dl/big.mp4"},
						},
					},
				},
			})
		case "/dl/big.mp4":
			_, _ = w.Write([]byte("fake-video-bytes"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	src := NewPexelsSource("px-key", WithPexelsBaseURL(srv.URL))
	assets, err := src.Search(context.Background(), SearchRequest{Query: "sunrise", Orientation: "portrait", Count: 3})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if gotAuth != "px-key" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotQuery != "sunrise" || gotOrientation != "portrait" {
		t.Errorf("query/orientation = %q/%q", gotQuery, gotOrientation)
	}
	if len(assets) != 1 {
		t.Fatalf("assets = %d, want 1", len(assets))
	}
	a := assets[0]
	if a.Type != AssetVideo || a.ID != "12345" || a.DurationSec != 12 {
		t.Errorf("asset = %+v", a)
	}
	if a.URL != srv.URL+"/dl/big.mp4" {
		t.Errorf("should pick highest-res file, got %q", a.URL)
	}

	dest := filepath.Join(t.TempDir(), "clip.mp4")
	if err := src.Download(context.Background(), a, dest); err != nil {
		t.Fatalf("Download: %v", err)
	}
	data, _ := os.ReadFile(dest)
	if string(data) != "fake-video-bytes" {
		t.Errorf("downloaded = %q", data)
	}
}

func TestPexelsSearchEmpty(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"videos": []any{}})
	}))
	t.Cleanup(srv.Close)

	src := NewPexelsSource("k", WithPexelsBaseURL(srv.URL))
	assets, err := src.Search(context.Background(), SearchRequest{Query: "nothing"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(assets) != 0 {
		t.Errorf("assets = %d, want 0", len(assets))
	}
}

func TestPixabaySearchImages(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"hits": []map[string]any{
					{"id": 777, "largeImageURL": srv.URL + "/img/large.jpg", "imageWidth": 1920, "imageHeight": 2880},
				},
			})
			return
		}
		_, _ = w.Write([]byte("fake-image"))
	}))
	t.Cleanup(srv.Close)

	src := NewPixabaySource("pb-key", WithPixabayBaseURL(srv.URL))
	assets, err := src.Search(context.Background(), SearchRequest{Query: "coffee", Count: 2})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(assets) != 1 {
		t.Fatalf("assets = %d, want 1", len(assets))
	}
	if assets[0].Type != AssetImage || assets[0].ID != "777" {
		t.Errorf("asset = %+v", assets[0])
	}
}

func TestFallbackChain(t *testing.T) {
	empty := &stubSource{name: "empty"}
	full := &stubSource{name: "full", assets: []Asset{{ID: "a1", Type: AssetVideo}}}

	chain := NewChain(empty, full)
	assets, err := chain.Search(context.Background(), SearchRequest{Query: "x"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(assets) != 1 || assets[0].ID != "a1" {
		t.Errorf("assets = %+v", assets)
	}
}

type stubSource struct {
	name   string
	assets []Asset
}

var _ MaterialSource = (*stubSource)(nil)

func (s *stubSource) Search(ctx context.Context, req SearchRequest) ([]Asset, error) {
	return s.assets, nil
}
func (s *stubSource) Download(ctx context.Context, a Asset, dest string) error { return nil }
func (s *stubSource) Name() string                                            { return s.name }

func TestLocalScan(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"photo.jpg", "photo2.PNG", "clip.mp4", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("x"), 0o644); err != nil {
			t.Fatalf("write %s: %v", f, err)
		}
	}

	src := NewLocalSource(func(ctx context.Context, path string) (float64, error) { return 7.5, nil })
	assets, err := src.Scan(context.Background(), dir)
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(assets) != 3 {
		t.Fatalf("assets = %d, want 3 (txt skipped)", len(assets))
	}

	byID := map[string]Asset{}
	for _, a := range assets {
		byID[filepath.Base(a.ID)] = a
	}
	if byID["photo.jpg"].Type != AssetImage {
		t.Errorf("photo.jpg type = %q", byID["photo.jpg"].Type)
	}
	if byID["clip.mp4"].Type != AssetVideo {
		t.Errorf("clip.mp4 type = %q", byID["clip.mp4"].Type)
	}
	if byID["clip.mp4"].DurationSec != 7.5 {
		t.Errorf("clip.mp4 duration = %v", byID["clip.mp4"].DurationSec)
	}
}

func TestLocalDownloadCopies(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "orig.jpg")
	if err := os.WriteFile(srcPath, []byte("image-bytes"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	src := NewLocalSource(nil)
	dest := filepath.Join(dir, "copy.jpg")
	if err := src.Download(context.Background(), Asset{ID: srcPath, URL: srcPath, Type: AssetImage}, dest); err != nil {
		t.Fatalf("Download: %v", err)
	}
	data, _ := os.ReadFile(dest)
	if string(data) != "image-bytes" {
		t.Errorf("copied = %q", data)
	}
}
