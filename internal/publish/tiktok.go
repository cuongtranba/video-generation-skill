package publish

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultTikTokBaseURL = "https://open.tiktokapis.com"

const (
	statusPublishComplete = "PUBLISH_COMPLETE"
	statusFailed          = "FAILED"
)

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

func WithBaseURL(u string) TikTokOption { return func(p *TikTokPublisher) { p.baseURL = u } }
func WithPollInterval(d time.Duration) TikTokOption {
	return func(p *TikTokPublisher) { p.pollInterval = d }
}
func WithPollTimeout(d time.Duration) TikTokOption {
	return func(p *TikTokPublisher) { p.pollTimeout = d }
}
func WithHTTPClient(c *http.Client) TikTokOption { return func(p *TikTokPublisher) { p.httpClient = c } }

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

type initRequest struct {
	PostInfo   postInfo   `json:"post_info"`
	SourceInfo sourceInfo `json:"source_info"`
}

type postInfo struct {
	Title        string `json:"title"`
	PrivacyLevel string `json:"privacy_level"`
}

type sourceInfo struct {
	Source          string `json:"source"`
	VideoSize       int    `json:"video_size"`
	ChunkSize       int    `json:"chunk_size"`
	TotalChunkCount int    `json:"total_chunk_count"`
}

type statusRequest struct {
	PublishID string `json:"publish_id"`
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

// statusResponse mirrors the TikTok status/fetch response. PublicPostID is
// only populated once status reaches PUBLISH_COMPLETE for a publicly visible
// post (per developers.tiktok.com/doc/content-posting-api-reference-get-video-status).
type statusResponse struct {
	Data struct {
		Status       string `json:"status"`
		PublicPostID string `json:"publicaly_available_post_id"`
		FailReason   string `json:"fail_reason"`
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
	if len(video) == 0 {
		return PublishResult{}, fmt.Errorf("tiktok: video file %s is empty", req.VideoPath)
	}

	init, err := p.initUpload(ctx, req, len(video))
	if err != nil {
		return PublishResult{}, err
	}
	if err := p.uploadBytes(ctx, init.Data.UploadURL, video); err != nil {
		return PublishResult{}, err
	}
	postID, err := p.pollStatus(ctx, init.Data.PublishID)
	if err != nil {
		return PublishResult{}, err
	}
	return PublishResult{PublishID: init.Data.PublishID, URL: postID}, nil
}

func (p *TikTokPublisher) initUpload(ctx context.Context, req PublishRequest, size int) (initResponse, error) {
	body := initRequest{
		PostInfo: postInfo{Title: req.Caption, PrivacyLevel: privacyLevel(req.Privacy)},
		SourceInfo: sourceInfo{
			Source:          "FILE_UPLOAD",
			VideoSize:       size,
			ChunkSize:       size,
			TotalChunkCount: 1,
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
		return initResponse{}, fmt.Errorf("tiktok init upload: status %d: %s", resp.StatusCode, readErrBody(resp.Body))
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
		return fmt.Errorf("tiktok upload bytes: status %d: %s", resp.StatusCode, readErrBody(resp.Body))
	}
	return nil
}

// pollStatus polls publish status until PUBLISH_COMPLETE and returns the
// publicly-available post ID (empty if the post is not publicly visible).
func (p *TikTokPublisher) pollStatus(ctx context.Context, publishID string) (string, error) {
	deadline := time.Now().Add(p.pollTimeout)
	for {
		status, err := p.fetchStatus(ctx, publishID)
		if err != nil {
			return "", err
		}
		switch status.Data.Status {
		case statusPublishComplete:
			return status.Data.PublicPostID, nil
		case statusFailed:
			return "", fmt.Errorf("tiktok publish failed for %s: %s", publishID, status.Data.FailReason)
		}
		if time.Now().After(deadline) {
			return "", fmt.Errorf("tiktok publish %s not complete after %s (last status %s)", publishID, p.pollTimeout, status.Data.Status)
		}
		select {
		case <-ctx.Done():
			return "", fmt.Errorf("wait for tiktok publish: %w", ctx.Err())
		case <-time.After(p.pollInterval):
		}
	}
}

func (p *TikTokPublisher) fetchStatus(ctx context.Context, publishID string) (statusResponse, error) {
	raw, err := json.Marshal(statusRequest{PublishID: publishID})
	if err != nil {
		return statusResponse{}, fmt.Errorf("marshal status request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		p.baseURL+"/v2/post/publish/status/fetch/", bytes.NewReader(raw))
	if err != nil {
		return statusResponse{}, fmt.Errorf("build status request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.accessToken)
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return statusResponse{}, fmt.Errorf("tiktok fetch status: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusResponse{}, fmt.Errorf("tiktok fetch status: status %d: %s", resp.StatusCode, readErrBody(resp.Body))
	}
	var out statusResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return statusResponse{}, fmt.Errorf("parse status response: %w", err)
	}
	return out, nil
}

// readErrBody drains up to 2KB of an error response body for inclusion in
// error messages, trimming surrounding whitespace.
func readErrBody(r io.Reader) string {
	b, _ := io.ReadAll(io.LimitReader(r, 2048))
	return strings.TrimSpace(string(b))
}

func privacyLevel(privacy string) string {
	if privacy == "public" {
		return "PUBLIC_TO_EVERYONE"
	}
	return "SELF_ONLY"
}
