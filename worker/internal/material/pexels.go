package material

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const defaultPexelsBaseURL = "https://api.pexels.com"

type PexelsSource struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

var _ MaterialSource = (*PexelsSource)(nil)

type PexelsOption func(*PexelsSource)

func WithPexelsBaseURL(u string) PexelsOption {
	return func(s *PexelsSource) { s.baseURL = u }
}

func NewPexelsSource(apiKey string, opts ...PexelsOption) *PexelsSource {
	s := &PexelsSource{
		apiKey:     apiKey,
		baseURL:    defaultPexelsBaseURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *PexelsSource) Name() string { return "pexels" }

type pexelsVideoFile struct {
	ID      int    `json:"id"`
	Quality string `json:"quality"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Link    string `json:"link"`
}

type pexelsVideo struct {
	ID         int               `json:"id"`
	Duration   float64           `json:"duration"`
	Width      int               `json:"width"`
	Height     int               `json:"height"`
	VideoFiles []pexelsVideoFile `json:"video_files"`
}

type pexelsSearchResponse struct {
	Videos []pexelsVideo `json:"videos"`
}

func (s *PexelsSource) Search(ctx context.Context, req SearchRequest) ([]Asset, error) {
	q := url.Values{}
	q.Set("query", req.Query)
	if req.Orientation != "" {
		q.Set("orientation", req.Orientation)
	}
	if req.Count > 0 {
		q.Set("per_page", strconv.Itoa(req.Count))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/videos/search?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build pexels search request: %w", err)
	}
	httpReq.Header.Set("Authorization", s.apiKey)

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("pexels search %q: %w", req.Query, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pexels search %q: status %d", req.Query, resp.StatusCode)
	}

	var body pexelsSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("parse pexels response: %w", err)
	}

	assets := make([]Asset, 0, len(body.Videos))
	for _, v := range body.Videos {
		best := bestVideoFile(v.VideoFiles)
		if best.Link == "" {
			continue
		}
		assets = append(assets, Asset{
			ID:          strconv.Itoa(v.ID),
			Type:        AssetVideo,
			URL:         best.Link,
			Width:       best.Width,
			Height:      best.Height,
			DurationSec: v.Duration,
			Source:      s.Name(),
		})
	}
	return assets, nil
}

func bestVideoFile(files []pexelsVideoFile) pexelsVideoFile {
	var best pexelsVideoFile
	for _, f := range files {
		if f.Width*f.Height > best.Width*best.Height {
			best = f
		}
	}
	return best
}

func (s *PexelsSource) Download(ctx context.Context, asset Asset, destPath string) error {
	if err := downloadURL(ctx, s.httpClient, asset.URL, destPath); err != nil {
		return fmt.Errorf("pexels download asset %s: %w", asset.ID, err)
	}
	return nil
}
