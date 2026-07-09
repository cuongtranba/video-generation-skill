# Provider Adapters + YAML Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make voice, music, stock material, AI clip-gen, and publish providers pluggable via a YAML config file, with TikTok publish as the first real publish provider.

**Architecture:** One `NewFromConfig` factory per category package (no global registry — Uber "no package-level mutable state"). A new `internal/config` YAML layer selects providers; API keys stay in `.env`. New `internal/videogen` (interface seam only) and `internal/publish` (TikTok real impl) packages. New `published` project status + `vidgen publish` command.

**Tech Stack:** Go 1.25, cobra, `gopkg.in/yaml.v3`, `net/http`, `httptest` for tests. TikTok Content Posting API (`open.tiktokapis.com`).

---

## File Structure

- Create `internal/config/providers.go` — `ProvidersConfig` typed structs, `DefaultProvidersConfig`, `LoadProviders`.
- Create `internal/config/providers_test.go`.
- Modify `internal/config/config.go` — `ValidateForGenerate` becomes provider-aware.
- Create `internal/tts/factory.go` + `factory_test.go` — `NewFromConfig`.
- Create `internal/music/factory.go` + `factory_test.go` — `NewFromConfig`, no-op source.
- Create `internal/material/factory.go` + `factory_test.go` — `NewFromConfig` builds `Chain`.
- Create `internal/videogen/videogen.go` — `ClipGenerator` interface (seam).
- Create `internal/publish/publish.go` — `Publisher` interface + `NewFromConfig`.
- Create `internal/publish/tiktok.go` + `tiktok_test.go` — `TikTokPublisher`.
- Modify `internal/domain/project.go` — add `StatusPublished`, extend `Next()`.
- Modify `internal/cli/root.go` — `--config` flag, factory wiring, `publish` command.
- Modify `README.md`, `CLAUDE.md` — document config file + publish.

Env keys used: existing (`FPT_TTS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `JAMENDO_CLIENT_ID`) + new `TIKTOK_ACCESS_TOKEN`.

---

## Task 1: YAML providers config

**Files:**
- Create: `internal/config/providers.go`
- Test: `internal/config/providers_test.go`
- Modify: `go.mod` (add `gopkg.in/yaml.v3`)

- [ ] **Step 1: Add the yaml dependency**

Fetch current usage from Context7 first (announce "Fetching docs from Context7..."), then:

Run: `go get gopkg.in/yaml.v3@latest`
Expected: `go.mod` gains `require gopkg.in/yaml.v3 vX.Y.Z`.

- [ ] **Step 2: Write the failing test**

Create `internal/config/providers_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultProvidersConfig(t *testing.T) {
	got := DefaultProvidersConfig()
	if got.TTS.Provider != "fpt" || got.TTS.Voice != "banmai" {
		t.Errorf("tts default = %+v", got.TTS)
	}
	if got.Music.Provider != "jamendo" {
		t.Errorf("music default = %q", got.Music.Provider)
	}
	if len(got.Material.Providers) != 2 || got.Material.Providers[0] != "pexels" {
		t.Errorf("material default = %v", got.Material.Providers)
	}
	if got.VideoGen.Provider != "none" || got.Publish.Provider != "none" {
		t.Errorf("videogen/publish default = %q/%q", got.VideoGen.Provider, got.Publish.Provider)
	}
}

func TestLoadProvidersAbsentFileReturnsDefaults(t *testing.T) {
	got, err := LoadProviders(filepath.Join(t.TempDir(), "nope.yaml"))
	if err != nil {
		t.Fatalf("LoadProviders: %v", err)
	}
	if got.TTS.Provider != "fpt" {
		t.Errorf("want defaults, got %+v", got)
	}
}

func TestLoadProvidersPartialFillsFromDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("publish:\n  provider: tiktok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadProviders(path)
	if err != nil {
		t.Fatalf("LoadProviders: %v", err)
	}
	if got.Publish.Provider != "tiktok" {
		t.Errorf("publish = %q, want tiktok", got.Publish.Provider)
	}
	if got.TTS.Provider != "fpt" {
		t.Errorf("tts should fill from default, got %q", got.TTS.Provider)
	}
	if len(got.Material.Providers) != 2 {
		t.Errorf("material should fill from default, got %v", got.Material.Providers)
	}
}

func TestLoadProvidersMalformedYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.yaml")
	if err := os.WriteFile(path, []byte("tts: [not a map\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProviders(path); err == nil {
		t.Fatal("want error for malformed yaml")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/config/ -run TestLoadProviders -v`
Expected: FAIL — `undefined: LoadProviders`.

- [ ] **Step 4: Write the implementation**

Create `internal/config/providers.go`:

```go
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"
)

// ProvidersConfig selects which provider implements each pipeline category.
// Secrets never live here — API keys come from Config (.env / env vars).
type ProvidersConfig struct {
	TTS      TTSSelect      `yaml:"tts"`
	Music    MusicSelect    `yaml:"music"`
	Material MaterialSelect `yaml:"material"`
	VideoGen VideoGenSelect `yaml:"videogen"`
	Publish  PublishSelect  `yaml:"publish"`
}

type TTSSelect struct {
	Provider string `yaml:"provider"`
	Voice    string `yaml:"voice"`
	Speed    int    `yaml:"speed"`
}

type MusicSelect struct {
	Provider string `yaml:"provider"`
}

type MaterialSelect struct {
	Providers []string `yaml:"providers"`
}

type VideoGenSelect struct {
	Provider string `yaml:"provider"`
}

type PublishSelect struct {
	Provider string `yaml:"provider"`
}

func DefaultProvidersConfig() ProvidersConfig {
	return ProvidersConfig{
		TTS:      TTSSelect{Provider: "fpt", Voice: "banmai", Speed: 0},
		Music:    MusicSelect{Provider: "jamendo"},
		Material: MaterialSelect{Providers: []string{"pexels", "pixabay"}},
		VideoGen: VideoGenSelect{Provider: "none"},
		Publish:  PublishSelect{Provider: "none"},
	}
}

// LoadProviders reads a YAML config file, filling any unset field from
// DefaultProvidersConfig. An absent file yields pure defaults (no error).
func LoadProviders(path string) (ProvidersConfig, error) {
	cfg := DefaultProvidersConfig()
	if path == "" {
		return cfg, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return cfg, nil
		}
		return ProvidersConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return ProvidersConfig{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	return fillDefaults(cfg), nil
}

func fillDefaults(cfg ProvidersConfig) ProvidersConfig {
	d := DefaultProvidersConfig()
	if cfg.TTS.Provider == "" {
		cfg.TTS.Provider = d.TTS.Provider
	}
	if cfg.TTS.Voice == "" {
		cfg.TTS.Voice = d.TTS.Voice
	}
	if cfg.Music.Provider == "" {
		cfg.Music.Provider = d.Music.Provider
	}
	if len(cfg.Material.Providers) == 0 {
		cfg.Material.Providers = d.Material.Providers
	}
	if cfg.VideoGen.Provider == "" {
		cfg.VideoGen.Provider = d.VideoGen.Provider
	}
	if cfg.Publish.Provider == "" {
		cfg.Publish.Provider = d.Publish.Provider
	}
	return cfg
}
```

Note: unmarshalling into a pre-filled struct preserves defaults for absent
scalar keys, but a present-but-empty section (e.g. `tts:` with no children)
leaves zero values — `fillDefaults` restores them.

- [ ] **Step 5: Run tests to verify they pass**

Run: `go test ./internal/config/ -v`
Expected: PASS (all, including existing config tests).

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum internal/config/providers.go internal/config/providers_test.go
git commit -m "feat(config): YAML provider-selection config with defaults"
```

---

## Task 2: TTS factory

**Files:**
- Create: `internal/tts/factory.go`
- Test: `internal/tts/factory_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/tts/factory_test.go`:

```go
package tts

import (
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfigFPT(t *testing.T) {
	p, err := NewFromConfig(config.TTSSelect{Provider: "fpt"}, "key")
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	if _, ok := p.(*FPTAIProvider); !ok {
		t.Errorf("want *FPTAIProvider, got %T", p)
	}
}

func TestNewFromConfigElevenLabsNotImplemented(t *testing.T) {
	if _, err := NewFromConfig(config.TTSSelect{Provider: "elevenlabs"}, "key"); err == nil {
		t.Fatal("want not-implemented error")
	}
}

func TestNewFromConfigUnknown(t *testing.T) {
	if _, err := NewFromConfig(config.TTSSelect{Provider: "bogus"}, "key"); err == nil {
		t.Fatal("want unknown-provider error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/tts/ -run TestNewFromConfig -v`
Expected: FAIL — `undefined: NewFromConfig`.

- [ ] **Step 3: Write the implementation**

Create `internal/tts/factory.go`:

```go
package tts

import (
	"fmt"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

// NewFromConfig builds a TTSProvider from the selected provider name.
// apiKey is the credential for the chosen provider (from .env / env).
func NewFromConfig(sel config.TTSSelect, apiKey string) (TTSProvider, error) {
	switch sel.Provider {
	case "fpt":
		return NewFPTAIProvider(apiKey), nil
	case "elevenlabs":
		return nil, fmt.Errorf("tts provider %q not implemented yet (supported: fpt)", sel.Provider)
	default:
		return nil, fmt.Errorf("unknown tts provider %q (supported: fpt)", sel.Provider)
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/tts/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/tts/factory.go internal/tts/factory_test.go
git commit -m "feat(tts): NewFromConfig factory (fpt real, elevenlabs seam)"
```

---

## Task 3: Music factory + no-op source

**Files:**
- Create: `internal/music/factory.go`
- Test: `internal/music/factory_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/music/factory_test.go`:

```go
package music

import (
	"context"
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfigJamendo(t *testing.T) {
	s, err := NewFromConfig(config.MusicSelect{Provider: "jamendo"}, "cid")
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	if _, ok := s.(*JamendoSource); !ok {
		t.Errorf("want *JamendoSource, got %T", s)
	}
}

func TestNewFromConfigNoneReturnsEmpty(t *testing.T) {
	s, err := NewFromConfig(config.MusicSelect{Provider: "none"}, "")
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	tracks, err := s.Search(context.Background(), Query{Tags: "chill"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(tracks) != 0 {
		t.Errorf("none source should return 0 tracks, got %d", len(tracks))
	}
}

func TestNewFromConfigUnknown(t *testing.T) {
	if _, err := NewFromConfig(config.MusicSelect{Provider: "spotify"}, ""); err == nil {
		t.Fatal("want unknown-provider error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/music/ -run TestNewFromConfig -v`
Expected: FAIL — `undefined: NewFromConfig`.

- [ ] **Step 3: Write the implementation**

Create `internal/music/factory.go`:

```go
package music

import (
	"context"
	"fmt"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

// NewFromConfig builds a MusicSource from the selected provider name.
func NewFromConfig(sel config.MusicSelect, clientID string) (MusicSource, error) {
	switch sel.Provider {
	case "jamendo":
		return NewJamendoSource(clientID), nil
	case "none":
		return noopSource{}, nil
	default:
		return nil, fmt.Errorf("unknown music provider %q (supported: jamendo, none)", sel.Provider)
	}
}

// noopSource disables background music: no tracks, never downloads.
type noopSource struct{}

var _ MusicSource = noopSource{}

func (noopSource) Search(ctx context.Context, q Query) ([]Track, error) { return nil, nil }

func (noopSource) Download(ctx context.Context, track Track, destPath string) error {
	return fmt.Errorf("music disabled (provider: none): nothing to download")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/music/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/music/factory.go internal/music/factory_test.go
git commit -m "feat(music): NewFromConfig factory with jamendo + none no-op"
```

---

## Task 4: Material factory (provider chain)

**Files:**
- Create: `internal/material/factory.go`
- Test: `internal/material/factory_test.go`

Existing source names (from `Name()`): `pexels`, `pixabay`, `local`. TikTok pull
is a selectable name that returns not-implemented.

- [ ] **Step 1: Write the failing test**

Create `internal/material/factory_test.go`:

```go
package material

import (
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

func TestNewFromConfigBuildsChainInOrder(t *testing.T) {
	keys := config.Config{PexelsAPIKey: "p", PixabayAPIKey: "x"}
	src, err := NewFromConfig(config.MaterialSelect{Providers: []string{"pixabay", "pexels"}}, keys)
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	ch, ok := src.(*Chain)
	if !ok {
		t.Fatalf("want *Chain, got %T", src)
	}
	if len(ch.sources) != 2 {
		t.Fatalf("want 2 sources, got %d", len(ch.sources))
	}
	if ch.sources[0].Name() != "pixabay" || ch.sources[1].Name() != "pexels" {
		t.Errorf("chain order = [%s, %s], want [pixabay, pexels]",
			ch.sources[0].Name(), ch.sources[1].Name())
	}
}

func TestNewFromConfigTikTokNotImplemented(t *testing.T) {
	if _, err := NewFromConfig(config.MaterialSelect{Providers: []string{"tiktok"}}, config.Config{}); err == nil {
		t.Fatal("want not-implemented error for tiktok pull")
	}
}

func TestNewFromConfigUnknown(t *testing.T) {
	if _, err := NewFromConfig(config.MaterialSelect{Providers: []string{"giphy"}}, config.Config{}); err == nil {
		t.Fatal("want unknown-provider error")
	}
}

func TestNewFromConfigEmpty(t *testing.T) {
	if _, err := NewFromConfig(config.MaterialSelect{Providers: nil}, config.Config{}); err == nil {
		t.Fatal("want error for empty provider list")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/material/ -run TestNewFromConfig -v`
Expected: FAIL — `undefined: NewFromConfig`.

- [ ] **Step 3: Write the implementation**

Create `internal/material/factory.go`:

```go
package material

import (
	"fmt"

	"github.com/cuongtranba/video-generation-skill/internal/config"
)

// NewFromConfig builds a MaterialSource (a Chain) from an ordered provider list.
// The first provider in the list is tried first during search.
func NewFromConfig(sel config.MaterialSelect, keys config.Config) (MaterialSource, error) {
	if len(sel.Providers) == 0 {
		return nil, fmt.Errorf("material: no providers configured (supported: pexels, pixabay)")
	}
	sources := make([]MaterialSource, 0, len(sel.Providers))
	for _, name := range sel.Providers {
		switch name {
		case "pexels":
			sources = append(sources, NewPexelsSource(keys.PexelsAPIKey))
		case "pixabay":
			sources = append(sources, NewPixabaySource(keys.PixabayAPIKey))
		case "tiktok":
			return nil, fmt.Errorf("material provider %q not implemented yet: no compliant public download API (supported: pexels, pixabay)", name)
		default:
			return nil, fmt.Errorf("unknown material provider %q (supported: pexels, pixabay)", name)
		}
	}
	return NewChain(sources...), nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/material/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/material/factory.go internal/material/factory_test.go
git commit -m "feat(material): NewFromConfig builds ordered source chain"
```

---

## Task 5: videogen interface seam

**Files:**
- Create: `internal/videogen/videogen.go`

No test — interface-only package with no implementation yet (nothing to assert).

- [ ] **Step 1: Write the interface**

Create `internal/videogen/videogen.go`:

```go
// Package videogen defines the seam for AI clip-generation providers
// (e.g. Runway, Kling). No provider is implemented yet; the interface exists
// so config selection and future wiring have a stable contract.
package videogen

import "context"

type ClipRequest struct {
	Prompt      string
	DurationSec float64
	Width       int
	Height      int
}

type ClipResult struct {
	ClipPath    string
	DurationSec float64
}

// ClipGenerator produces a video clip from a text prompt.
type ClipGenerator interface {
	Generate(ctx context.Context, req ClipRequest, destPath string) (ClipResult, error)
}
```

- [ ] **Step 2: Verify it builds**

Run: `go build ./internal/videogen/`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add internal/videogen/videogen.go
git commit -m "feat(videogen): ClipGenerator interface seam (no impl)"
```

---

## Task 6: Publisher interface + factory

**Files:**
- Create: `internal/publish/publish.go`

- [ ] **Step 1: Write the interface and factory**

Create `internal/publish/publish.go`:

```go
// Package publish uploads a rendered video to a distribution platform.
package publish

import (
	"context"
	"fmt"
)

type PublishRequest struct {
	VideoPath string
	Caption   string
	Privacy   string // "public" | "private" (provider-mapped)
}

type PublishResult struct {
	PublishID string
	URL       string
}

// Publisher uploads a rendered video and returns the platform post reference.
type Publisher interface {
	Publish(ctx context.Context, req PublishRequest) (PublishResult, error)
}

// NewFromConfig builds a Publisher from the selected provider name.
// accessToken is the OAuth credential for the chosen platform.
func NewFromConfig(provider, accessToken string) (Publisher, error) {
	switch provider {
	case "tiktok":
		return NewTikTokPublisher(accessToken), nil
	case "youtube", "instagram":
		return nil, fmt.Errorf("publish provider %q not implemented yet (supported: tiktok)", provider)
	case "none", "":
		return nil, fmt.Errorf("no publish provider configured: set publish.provider in config.yaml (supported: tiktok)")
	default:
		return nil, fmt.Errorf("unknown publish provider %q (supported: tiktok)", provider)
	}
}
```

- [ ] **Step 2: Verify it builds (TikTok impl comes next task)**

Run: `go build ./internal/publish/ 2>&1 | head`
Expected: FAIL — `undefined: NewTikTokPublisher`. That's expected; Task 7 defines it. Do NOT commit yet.

---

## Task 7: TikTok publisher

**Files:**
- Create: `internal/publish/tiktok.go`
- Test: `internal/publish/tiktok_test.go`

Fetch current TikTok Content Posting API shapes from Context7/web before coding
(announce "Fetching docs from Context7..."). Endpoints below reflect the v2 API:
`/v2/post/publish/video/init/` → returns `publish_id` + `upload_url`; PUT bytes
to `upload_url`; poll `/v2/post/publish/status/fetch/` until
`status == "PUBLISH_COMPLETE"`.

- [ ] **Step 1: Write the failing test**

Create `internal/publish/tiktok_test.go`:

```go
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
			"data":  map[string]any{"status": status, "publicaly_available_post_id": []string{"vid-9"}},
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/publish/ -run TestPublish -v`
Expected: FAIL — `undefined: TikTokPublisher`.

- [ ] **Step 3: Write the implementation**

Create `internal/publish/tiktok.go`:

```go
package publish

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

const defaultTikTokBaseURL = "https://open.tiktokapis.com"

var _ Publisher = (*TikTokPublisher)(nil)

// TikTokPublisher uploads videos via the TikTok Content Posting API v2.
type TikTokPublisher struct {
	accessToken  string
	baseURL      string
	httpClient   *http.Client
	pollInterval time.Duration
	pollTimeout  time.Duration
}

type TikTokOption func(*TikTokPublisher)

func WithBaseURL(u string) TikTokOption      { return func(p *TikTokPublisher) { p.baseURL = u } }
func WithPollInterval(d time.Duration) TikTokOption {
	return func(p *TikTokPublisher) { p.pollInterval = d }
}
func WithPollTimeout(d time.Duration) TikTokOption {
	return func(p *TikTokPublisher) { p.pollTimeout = d }
}

func NewTikTokPublisher(accessToken string, opts ...TikTokOption) *TikTokPublisher {
	p := &TikTokPublisher{
		accessToken:  accessToken,
		baseURL:      defaultTikTokBaseURL,
		httpClient:   &http.Client{Timeout: 60 * time.Second},
		pollInterval: 3 * time.Second,
		pollTimeout:  3 * time.Minute,
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

type initResponse struct {
	Data struct {
		PublishID string `json:"publish_id"`
		UploadURL string `json:"upload_url"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type statusResponse struct {
	Data struct {
		Status string `json:"status"`
	} `json:"data"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (p *TikTokPublisher) Publish(ctx context.Context, req PublishRequest) (PublishResult, error) {
	if p.accessToken == "" {
		return PublishResult{}, fmt.Errorf("tiktok: missing access token (set TIKTOK_ACCESS_TOKEN)")
	}
	video, err := os.ReadFile(req.VideoPath)
	if err != nil {
		return PublishResult{}, fmt.Errorf("read video %s: %w", req.VideoPath, err)
	}

	init, err := p.initUpload(ctx, req, len(video))
	if err != nil {
		return PublishResult{}, err
	}
	if err := p.uploadBytes(ctx, init.Data.UploadURL, video); err != nil {
		return PublishResult{}, err
	}
	if err := p.pollStatus(ctx, init.Data.PublishID); err != nil {
		return PublishResult{}, err
	}
	return PublishResult{PublishID: init.Data.PublishID}, nil
}

func (p *TikTokPublisher) initUpload(ctx context.Context, req PublishRequest, size int) (initResponse, error) {
	body := map[string]any{
		"post_info": map[string]any{
			"title":           req.Caption,
			"privacy_level":   privacyLevel(req.Privacy),
		},
		"source_info": map[string]any{
			"source":            "FILE_UPLOAD",
			"video_size":        size,
			"chunk_size":        size,
			"total_chunk_count": 1,
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return initResponse{}, fmt.Errorf("marshal init request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		p.baseURL+"/v2/post/publish/video/init/", bytes.NewReader(raw))
	if err != nil {
		return initResponse{}, fmt.Errorf("build init request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.accessToken)
	httpReq.Header.Set("Content-Type", "application/json; charset=UTF-8")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return initResponse{}, fmt.Errorf("tiktok init upload: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return initResponse{}, fmt.Errorf("tiktok init upload: status %d", resp.StatusCode)
	}
	var out initResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return initResponse{}, fmt.Errorf("parse init response: %w", err)
	}
	if out.Data.PublishID == "" || out.Data.UploadURL == "" {
		return initResponse{}, fmt.Errorf("tiktok init upload: empty publish_id/upload_url (error %s: %s)", out.Error.Code, out.Error.Message)
	}
	return out, nil
}

func (p *TikTokPublisher) uploadBytes(ctx context.Context, uploadURL string, video []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(video))
	if err != nil {
		return fmt.Errorf("build upload request: %w", err)
	}
	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", len(video)-1, len(video)))

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("tiktok upload bytes: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("tiktok upload bytes: status %d", resp.StatusCode)
	}
	return nil
}

func (p *TikTokPublisher) pollStatus(ctx context.Context, publishID string) error {
	deadline := time.Now().Add(p.pollTimeout)
	for {
		status, err := p.fetchStatus(ctx, publishID)
		if err != nil {
			return err
		}
		switch status {
		case "PUBLISH_COMPLETE":
			return nil
		case "FAILED":
			return fmt.Errorf("tiktok publish failed for %s", publishID)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("tiktok publish %s not complete after %s (last status %s)", publishID, p.pollTimeout, status)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for tiktok publish: %w", ctx.Err())
		case <-time.After(p.pollInterval):
		}
	}
}

func (p *TikTokPublisher) fetchStatus(ctx context.Context, publishID string) (string, error) {
	raw, err := json.Marshal(map[string]string{"publish_id": publishID})
	if err != nil {
		return "", fmt.Errorf("marshal status request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		p.baseURL+"/v2/post/publish/status/fetch/", bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("build status request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.accessToken)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("tiktok fetch status: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tiktok fetch status: status %d", resp.StatusCode)
	}
	var out statusResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("parse status response: %w", err)
	}
	return out.Data.Status, nil
}

func privacyLevel(privacy string) string {
	if privacy == "public" {
		return "PUBLIC_TO_EVERYONE"
	}
	return "SELF_ONLY"
}
```

Note: verify field names (`privacy_level`, `source_info`, status strings)
against live TikTok docs during Step 1; adjust struct tags if the API differs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/publish/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/publish/publish.go internal/publish/tiktok.go internal/publish/tiktok_test.go
git commit -m "feat(publish): TikTok Content Posting publisher + factory"
```

---

## Task 8: Published status in domain

**Files:**
- Modify: `internal/domain/project.go:8-28`
- Test: `internal/domain/manifest_test.go` (add case)

- [ ] **Step 1: Write the failing test**

Add to `internal/domain/manifest_test.go` (near the existing `Next()` table at
line ~203):

```go
func TestStatusNextPublished(t *testing.T) {
	if got := StatusRendered.Next(); got != StatusPublished {
		t.Errorf("StatusRendered.Next() = %q, want %q", got, StatusPublished)
	}
	if got := StatusPublished.Next(); got != StatusPublished {
		t.Errorf("StatusPublished.Next() = %q, want %q (terminal)", got, StatusPublished)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/domain/ -run TestStatusNextPublished -v`
Expected: FAIL — `undefined: StatusPublished`.

- [ ] **Step 3: Edit the implementation**

In `internal/domain/project.go`, add the constant after `StatusRendered`:

```go
	StatusRendered  Status = "rendered"
	StatusPublished Status = "published"
```

Change `Next()` so `rendered` advances to `published` and `published` is
terminal. Replace the `default` arm:

```go
func (s Status) Next() Status {
	switch s {
	case StatusDraft:
		return StatusMaterial
	case StatusMaterial:
		return StatusTuned
	case StatusTuned:
		return StatusConfirmed
	case StatusConfirmed:
		return StatusRendered
	case StatusRendered:
		return StatusPublished
	default:
		return StatusPublished
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/domain/ -v`
Expected: PASS. If an existing `Next()` table asserted `StatusRendered.Next() == StatusRendered`, update that row to `StatusPublished` (check `manifest_test.go:203-204`).

- [ ] **Step 5: Commit**

```bash
git add internal/domain/project.go internal/domain/manifest_test.go
git commit -m "feat(domain): add published status after rendered"
```

---

## Task 9: Provider-aware validation

**Files:**
- Modify: `internal/config/config.go:42-54`
- Test: `internal/config/config_test.go` (add cases)

- [ ] **Step 1: Write the failing test**

Add to `internal/config/config_test.go`:

```go
func TestValidateForProvidersMusicNoneSkipsJamendo(t *testing.T) {
	cfg := Config{FPTTTSAPIKey: "k", PexelsAPIKey: "p"}
	providers := DefaultProvidersConfig()
	providers.Music.Provider = "none"
	if err := cfg.ValidateForProviders(providers); err != nil {
		t.Errorf("music=none should not require jamendo key: %v", err)
	}
}

func TestValidateForProvidersMissingSelectedKey(t *testing.T) {
	cfg := Config{PexelsAPIKey: "p"} // no FPT key
	providers := DefaultProvidersConfig()
	if err := cfg.ValidateForProviders(providers); err == nil {
		t.Fatal("want error for missing FPT_TTS_API_KEY when tts=fpt")
	}
}

func TestValidateForProvidersOnlyListedMaterial(t *testing.T) {
	cfg := Config{FPTTTSAPIKey: "k", PexelsAPIKey: "p"} // no pixabay key
	providers := DefaultProvidersConfig()
	providers.Material.Providers = []string{"pexels"}
	providers.Music.Provider = "none"
	if err := cfg.ValidateForProviders(providers); err != nil {
		t.Errorf("only pexels selected, pixabay key not required: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/config/ -run TestValidateForProviders -v`
Expected: FAIL — `undefined: ValidateForProviders`.

- [ ] **Step 3: Write the implementation**

Add to `internal/config/config.go` (keep the old `ValidateForGenerate` for now;
`ValidateForProviders` supersedes it in wiring):

```go
// ValidateForProviders checks that every credential required by the SELECTED
// providers is present. Unselected providers' keys are not required.
func (c Config) ValidateForProviders(p ProvidersConfig) error {
	var missing []string

	switch p.TTS.Provider {
	case "fpt":
		if c.FPTTTSAPIKey == "" {
			missing = append(missing, "FPT_TTS_API_KEY")
		}
	}

	for _, name := range p.Material.Providers {
		switch name {
		case "pexels":
			if c.PexelsAPIKey == "" {
				missing = append(missing, "PEXELS_API_KEY")
			}
		case "pixabay":
			if c.PixabayAPIKey == "" {
				missing = append(missing, "PIXABAY_API_KEY")
			}
		}
	}

	if p.Music.Provider == "jamendo" && c.JamendoClientID == "" {
		missing = append(missing, "JAMENDO_CLIENT_ID")
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required config for selected providers: %s", strings.Join(missing, ", "))
	}
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/config/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): ValidateForProviders checks only selected providers"
```

---

## Task 10: Wire factories + publish command in CLI

**Files:**
- Modify: `internal/cli/root.go`

No new unit test (wiring); verified by build + existing flow tests + manual run.

- [ ] **Step 1: Add the `--config` flag and load providers**

In `internal/cli/root.go`, add a `cfgPath` variable and flag in `NewRootCmd`
(alongside `baseDir`, around line 107-118):

```go
	var cfgPath string
	// ... inside NewRootCmd, after root.PersistentFlags().StringVar(&baseDir ...):
	root.PersistentFlags().StringVar(&cfgPath, "config", defaultConfigPath(), "provider config YAML")
```

Change `PersistentPreRunE` to pass `cfgPath`:

```go
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			return a.init(baseDir, cfgPath)
		},
```

Add `defaultConfigPath` near `defaultBaseDir` (line 31):

```go
func defaultConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "config.yaml"
	}
	return filepath.Join(home, ".vidgen", "config.yaml")
}
```

- [ ] **Step 2: Store providers on app and swap wiring in `init`**

Add field to `app` struct (line 24-29):

```go
type app struct {
	baseDir   string
	store     *domain.ManifestStore
	flow      *flow.Flow
	cfg       config.Config
	providers config.ProvidersConfig
}
```

Change `func (a *app) init(baseDir string)` to `func (a *app) init(baseDir, cfgPath string)`.
Replace the config-load + validation block (lines 62-69) with:

```go
	cfg, err := config.Load(".env")
	if err != nil {
		return err
	}
	providers, err := config.LoadProviders(cfgPath)
	if err != nil {
		return err
	}
	if err := cfg.ValidateForProviders(providers); err != nil {
		return err
	}
	a.cfg = cfg
	a.providers = providers
```

Replace the provider construction (lines 74-90) with factory calls:

```go
	probe := tts.FFProbeDuration(ffprobeBin)

	stock, err := material.NewFromConfig(providers.Material, cfg)
	if err != nil {
		return err
	}
	ttsProvider, err := tts.NewFromConfig(providers.TTS, cfg.FPTTTSAPIKey)
	if err != nil {
		return err
	}
	musicSource, err := music.NewFromConfig(providers.Music, cfg.JamendoClientID)
	if err != nil {
		return err
	}

	a.flow = flow.New(flow.Deps{
		Store:       a.store,
		Script:      script.NewClaudeCLIGenerator(claudeBin),
		Local:       material.NewLocalSource(material.DurationProbe(probe)),
		Stock:       stock,
		TTS:         ttsProvider,
		Probe:       probe,
		Transcriber: caption.NewWhisperRunner(whisperBin),
		Renderer:    render.NewFFmpegRenderer(ffmpegBin, ffprobeBin),
		Music:       musicSource,
	})
	return nil
```

- [ ] **Step 3: Verify build + existing tests**

Run: `go build ./... && go test ./internal/cli/ ./internal/flow/ -v`
Expected: PASS.

- [ ] **Step 4: Add the `publish` command**

Create a new file `internal/cli/publish.go`:

```go
package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/publish"
)

func (a *app) newPublishCmd() *cobra.Command {
	var projectID, caption, privacy string
	cmd := &cobra.Command{
		Use:   "publish",
		Short: "Publish a rendered project's video to the configured platform",
		RunE: func(cmd *cobra.Command, args []string) error {
			p, err := a.loadProject(projectID)
			if err != nil {
				return err
			}
			if p.Status != domain.StatusRendered && p.Status != domain.StatusPublished {
				return fmt.Errorf("project %s is %q, must be rendered before publish", p.ID, p.Status)
			}
			if p.OutputPath == "" {
				return fmt.Errorf("project %s has no rendered output", p.ID)
			}

			pub, err := publish.NewFromConfig(a.providers.Publish.Provider, a.cfg.TikTokAccessToken)
			if err != nil {
				return err
			}
			res, err := pub.Publish(context.Background(), publish.PublishRequest{
				VideoPath: p.OutputPath,
				Caption:   caption,
				Privacy:   privacy,
			})
			if err != nil {
				return fmt.Errorf("publish project %s: %w", p.ID, err)
			}

			p.Status = domain.StatusPublished
			if err := a.store.Save(p); err != nil {
				return fmt.Errorf("save project after publish: %w", err)
			}
			fmt.Printf("published %s (id %s)\n", p.ID, res.PublishID)
			return nil
		},
	}
	cmd.Flags().StringVar(&projectID, "project", "", "project id")
	cmd.Flags().StringVar(&caption, "caption", "", "post caption/title")
	cmd.Flags().StringVar(&privacy, "privacy", "private", "public | private")
	return cmd
}
```

Register it in `NewRootCmd` where other commands are added (`root.AddCommand(` at line 120):

```go
	root.AddCommand(
		// ... existing commands ...
		a.newPublishCmd(),
	)
```

- [ ] **Step 5: Add TikTokAccessToken to Config**

In `internal/config/config.go`, add the field and load it:

```go
type Config struct {
	FPTTTSAPIKey      string
	PexelsAPIKey      string
	PixabayAPIKey     string
	JamendoClientID   string
	TikTokAccessToken string
}
```

In `Load`, add to the returned struct:

```go
		TikTokAccessToken: get("TIKTOK_ACCESS_TOKEN"),
```

- [ ] **Step 6: Verify full build + all tests**

Run: `go build -o vidgen ./cmd/vidgen && go test ./... && go vet ./...`
Expected: PASS, clean vet.

- [ ] **Step 7: Commit**

```bash
git add internal/cli/root.go internal/cli/publish.go internal/config/config.go
git commit -m "feat(cli): wire provider factories + publish command"
```

---

## Task 11: Documentation sync

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the config file in README**

Add a "Provider configuration" section to `README.md` describing
`~/.vidgen/config.yaml`, the `--config` flag, the full YAML example (from the
design spec), which providers are real vs seams, and the new `TIKTOK_ACCESS_TOKEN`
key. Add a `vidgen publish --project <id>` usage example.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`:
- Add to Architecture: "Providers selected via `~/.vidgen/config.yaml` (`internal/config.LoadProviders`); each category package has a `NewFromConfig` factory. Keys stay in `.env`."
- Add to Keys: `TIKTOK_ACCESS_TOKEN` (publish).
- Add a status: pipeline is now `draft→material→tuned→confirmed→rendered→published`.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: provider config file + publish command"
```

---

## Final Verification

- [ ] `go build -o vidgen ./cmd/vidgen` — succeeds.
- [ ] `go test ./...` — green.
- [ ] `go vet ./...` — clean.
- [ ] `./vidgen generate --project <existing>` with **no** `~/.vidgen/config.yaml` — identical behavior to before, $0 (idempotent TTS). Confirms zero breaking change.
- [ ] (User, live) Write `~/.vidgen/config.yaml` with `publish.provider: tiktok`, set `TIKTOK_ACCESS_TOKEN`, run `./vidgen publish --project <rendered>` — real upload succeeds.
