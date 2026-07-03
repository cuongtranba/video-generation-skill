package music

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

const defaultJamendoBaseURL = "https://api.jamendo.com"

type Query struct {
	Tags  string // fuzzy tags, e.g. "upbeat", "chill acoustic"
	Limit int
}

type Track struct {
	ID          string
	Name        string
	Artist      string
	DurationSec float64
	DownloadURL string
	StreamURL   string
}

type MusicSource interface {
	Search(ctx context.Context, q Query) ([]Track, error)
	Download(ctx context.Context, track Track, destPath string) error
}

var _ MusicSource = (*JamendoSource)(nil)

// JamendoSource searches royalty-free music via the Jamendo v3.0 API.
type JamendoSource struct {
	clientID   string
	baseURL    string
	httpClient *http.Client
}

type JamendoOption func(*JamendoSource)

func WithJamendoBaseURL(u string) JamendoOption {
	return func(s *JamendoSource) { s.baseURL = u }
}

func NewJamendoSource(clientID string, opts ...JamendoOption) *JamendoSource {
	s := &JamendoSource{
		clientID:   clientID,
		baseURL:    defaultJamendoBaseURL,
		httpClient: &http.Client{Timeout: 60 * time.Second},
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

type jamendoTrack struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ArtistName    string  `json:"artist_name"`
	Duration      float64 `json:"duration"`
	AudioDownload string  `json:"audiodownload"`
	Audio         string  `json:"audio"`
}

type jamendoResponse struct {
	Results []jamendoTrack `json:"results"`
}

func (s *JamendoSource) Search(ctx context.Context, q Query) ([]Track, error) {
	if s.clientID == "" {
		return nil, fmt.Errorf("jamendo client id missing: set JAMENDO_CLIENT_ID (free at devportal.jamendo.com)")
	}

	limit := q.Limit
	if limit <= 0 {
		limit = 5
	}
	params := url.Values{}
	params.Set("client_id", s.clientID)
	params.Set("format", "json")
	params.Set("limit", strconv.Itoa(limit))
	params.Set("fuzzytags", q.Tags)
	params.Set("audioformat", "mp32")
	params.Set("include", "musicinfo")
	params.Set("order", "popularity_total")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+"/v3.0/tracks/?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build jamendo request: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jamendo search %q: %w", q.Tags, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jamendo search %q: status %d", q.Tags, resp.StatusCode)
	}

	var body jamendoResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("parse jamendo response: %w", err)
	}

	tracks := make([]Track, 0, len(body.Results))
	for _, t := range body.Results {
		dl := t.AudioDownload
		if dl == "" {
			dl = t.Audio
		}
		if dl == "" {
			continue
		}
		tracks = append(tracks, Track{
			ID:          t.ID,
			Name:        t.Name,
			Artist:      t.ArtistName,
			DurationSec: t.Duration,
			DownloadURL: dl,
			StreamURL:   t.Audio,
		})
	}
	return tracks, nil
}

func (s *JamendoSource) Download(ctx context.Context, track Track, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, track.DownloadURL, nil)
	if err != nil {
		return fmt.Errorf("build download request for track %s: %w", track.ID, err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("download track %s: %w", track.ID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download track %s: status %d", track.ID, resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("create %s: %w", destPath, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return fmt.Errorf("write %s: %w", destPath, err)
	}
	return nil
}
