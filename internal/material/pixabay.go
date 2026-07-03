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

const defaultPixabayBaseURL = "https://pixabay.com"

type PixabaySource struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

var _ MaterialSource = (*PixabaySource)(nil)

type PixabayOption func(*PixabaySource)

func WithPixabayBaseURL(u string) PixabayOption {
	return func(s *PixabaySource) { s.baseURL = u }
}

func NewPixabaySource(apiKey string, opts ...PixabayOption) *PixabaySource {
	s := &PixabaySource{
		apiKey:     apiKey,
		baseURL:    defaultPixabayBaseURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

func (s *PixabaySource) Name() string { return "pixabay" }

type pixabayHit struct {
	ID            int    `json:"id"`
	LargeImageURL string `json:"largeImageURL"`
	ImageWidth    int    `json:"imageWidth"`
	ImageHeight   int    `json:"imageHeight"`
}

type pixabayResponse struct {
	Hits []pixabayHit `json:"hits"`
}

func (s *PixabaySource) Search(ctx context.Context, req SearchRequest) ([]Asset, error) {
	q := url.Values{}
	q.Set("key", s.apiKey)
	q.Set("q", req.Query)
	q.Set("orientation", "vertical")
	if req.Count > 0 {
		q.Set("per_page", strconv.Itoa(req.Count))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/api/?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build pixabay search request: %w", err)
	}

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("pixabay search %q: %w", req.Query, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pixabay search %q: status %d", req.Query, resp.StatusCode)
	}

	var body pixabayResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("parse pixabay response: %w", err)
	}

	assets := make([]Asset, 0, len(body.Hits))
	for _, h := range body.Hits {
		if h.LargeImageURL == "" {
			continue
		}
		assets = append(assets, Asset{
			ID:     strconv.Itoa(h.ID),
			Type:   AssetImage,
			URL:    h.LargeImageURL,
			Width:  h.ImageWidth,
			Height: h.ImageHeight,
			Source: s.Name(),
		})
	}
	return assets, nil
}

func (s *PixabaySource) Download(ctx context.Context, asset Asset, destPath string) error {
	if err := downloadURL(ctx, s.httpClient, asset.URL, destPath); err != nil {
		return fmt.Errorf("pixabay download asset %s: %w", asset.ID, err)
	}
	return nil
}
