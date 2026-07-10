package tts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/cuongtranba/video-generation-skill/worker/internal/domain"
)

const (
	defaultEndpoint     = "https://api.fpt.ai/hmi/tts/v5"
	defaultPollInterval = 5 * time.Second
	defaultPollTimeout  = 2 * time.Minute
	maxChars            = 5000
	minChars            = 3
)

type SynthesizeRequest struct {
	Text  string
	Voice domain.Voice
	Speed domain.Speed
}

type SynthesizeResult struct {
	AudioPath    string
	DurationSec  float64
	CharsCharged int
}

type TTSProvider interface {
	Synthesize(ctx context.Context, req SynthesizeRequest, destPath string) (SynthesizeResult, error)
}

var _ TTSProvider = (*FPTAIProvider)(nil)

// DurationProbe measures the duration of an audio file in seconds.
type DurationProbe func(ctx context.Context, path string) (float64, error)

type FPTAIProvider struct {
	apiKey        string
	endpoint      string
	httpClient    *http.Client
	pollInterval  time.Duration
	pollTimeout   time.Duration
	durationProbe DurationProbe
}

type Option func(*FPTAIProvider)

func WithEndpoint(url string) Option {
	return func(p *FPTAIProvider) { p.endpoint = url }
}

func WithPollInterval(d time.Duration) Option {
	return func(p *FPTAIProvider) { p.pollInterval = d }
}

func WithPollTimeout(d time.Duration) Option {
	return func(p *FPTAIProvider) { p.pollTimeout = d }
}

func WithDurationProbe(probe DurationProbe) Option {
	return func(p *FPTAIProvider) { p.durationProbe = probe }
}

func WithHTTPClient(c *http.Client) Option {
	return func(p *FPTAIProvider) { p.httpClient = c }
}

func NewFPTAIProvider(apiKey string, opts ...Option) *FPTAIProvider {
	p := &FPTAIProvider{
		apiKey:        apiKey,
		endpoint:      defaultEndpoint,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
		pollInterval:  defaultPollInterval,
		pollTimeout:   defaultPollTimeout,
		durationProbe: FFProbeDuration("ffprobe"),
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

type fptResponse struct {
	Async     string `json:"async"`
	Error     int    `json:"error"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
}

func (p *FPTAIProvider) Synthesize(ctx context.Context, req SynthesizeRequest, destPath string) (SynthesizeResult, error) {
	if err := validate(req); err != nil {
		return SynthesizeResult{}, err
	}

	audioURL, err := p.submit(ctx, req)
	if err != nil {
		return SynthesizeResult{}, err
	}

	if err := p.pollAndDownload(ctx, audioURL, destPath); err != nil {
		return SynthesizeResult{}, err
	}

	duration, err := p.durationProbe(ctx, destPath)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("probe duration of %s: %w", destPath, err)
	}

	return SynthesizeResult{
		AudioPath:    destPath,
		DurationSec:  duration,
		CharsCharged: len([]rune(req.Text)),
	}, nil
}

func validate(req SynthesizeRequest) error {
	chars := len([]rune(req.Text))
	if chars < minChars || chars > maxChars {
		return fmt.Errorf("text length %d chars, must be %d-%d", chars, minChars, maxChars)
	}
	if !req.Voice.Valid() {
		return fmt.Errorf("invalid voice %q", req.Voice)
	}
	if !req.Speed.Valid() {
		return fmt.Errorf("invalid speed %d, must be -3..3", req.Speed)
	}
	return nil
}

func (p *FPTAIProvider) submit(ctx context.Context, req SynthesizeRequest) (audioURL string, err error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, strings.NewReader(req.Text))
	if err != nil {
		return "", fmt.Errorf("build FPT request: %w", err)
	}
	httpReq.Header.Set("api-key", p.apiKey)
	httpReq.Header.Set("voice", string(req.Voice))
	httpReq.Header.Set("speed", strconv.Itoa(int(req.Speed)))

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("call FPT TTS: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read FPT response: %w", err)
	}

	var fptResp fptResponse
	if err := json.Unmarshal(body, &fptResp); err != nil {
		return "", fmt.Errorf("parse FPT response %q: %w", truncate(string(body), 200), err)
	}
	if resp.StatusCode != http.StatusOK || fptResp.Error != 0 || fptResp.Async == "" {
		return "", fmt.Errorf("FPT TTS rejected request (status %d, error %d): %s", resp.StatusCode, fptResp.Error, fptResp.Message)
	}
	return fptResp.Async, nil
}

func (p *FPTAIProvider) pollAndDownload(ctx context.Context, audioURL, destPath string) error {
	deadline := time.Now().Add(p.pollTimeout)
	for {
		ready, err := p.tryDownload(ctx, audioURL, destPath)
		if err != nil {
			return err
		}
		if ready {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("FPT audio not ready after %s: %s", p.pollTimeout, audioURL)
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("wait for FPT audio: %w", ctx.Err())
		case <-time.After(p.pollInterval):
		}
	}
}

func (p *FPTAIProvider) tryDownload(ctx context.Context, audioURL, destPath string) (ready bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, audioURL, nil)
	if err != nil {
		return false, fmt.Errorf("build audio download request: %w", err)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("download FPT audio: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, nil
	}

	f, err := os.Create(destPath)
	if err != nil {
		return false, fmt.Errorf("create audio file %s: %w", destPath, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, resp.Body); err != nil {
		return false, fmt.Errorf("write audio file %s: %w", destPath, err)
	}
	return true, nil
}

// FFProbeDuration returns a DurationProbe backed by the ffprobe binary.
func FFProbeDuration(ffprobeBin string) DurationProbe {
	return func(ctx context.Context, path string) (float64, error) {
		out, err := exec.CommandContext(ctx, ffprobeBin,
			"-v", "error",
			"-show_entries", "format=duration",
			"-of", "default=noprint_wrappers=1:nokey=1",
			path,
		).Output()
		if err != nil {
			return 0, fmt.Errorf("ffprobe %s: %w", path, err)
		}
		duration, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		if err != nil {
			return 0, fmt.Errorf("parse ffprobe duration %q: %w", strings.TrimSpace(string(out)), err)
		}
		return duration, nil
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
