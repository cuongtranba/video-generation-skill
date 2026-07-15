package tts

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

const (
	elevenLabsBaseURL = "https://api.elevenlabs.io"
	// Default voice ID. A Vietnamese-capable voice so multilingual_v2 speaks
	// Vietnamese narration natively; override per deployment with
	// ELEVENLABS_VOICE_ID. ElevenLabs selects the voice by ID, not by the
	// FPT-style names the tune feature uses.
	elevenLabsDefaultVoice = "Na15FlRRkMEDtEW4nVVP"
	// eleven_turbo_v2_5 (unlike the older multilingual_v2) supports Vietnamese
	// with correct tones/pronunciation. Override with ELEVENLABS_MODEL_ID
	// (e.g. eleven_flash_v2_5, eleven_v3).
	elevenLabsDefaultModel  = "eleven_turbo_v2_5"
	elevenLabsOutputFormat  = "mp3_44100_128"
	elevenLabsRequestTimeout = 60 * time.Second
)

var _ TTSProvider = (*ElevenLabsProvider)(nil)

type ElevenLabsProvider struct {
	apiKey        string
	baseURL       string
	voiceID       string
	modelID       string
	outputFormat  string
	httpClient    *http.Client
	durationProbe DurationProbe
}

type ElevenLabsOption func(*ElevenLabsProvider)

func WithElevenLabsBaseURL(url string) ElevenLabsOption {
	return func(p *ElevenLabsProvider) { p.baseURL = url }
}

func WithElevenLabsVoiceID(id string) ElevenLabsOption {
	return func(p *ElevenLabsProvider) { p.voiceID = id }
}

func WithElevenLabsHTTPClient(c *http.Client) ElevenLabsOption {
	return func(p *ElevenLabsProvider) { p.httpClient = c }
}

func WithElevenLabsDurationProbe(probe DurationProbe) ElevenLabsOption {
	return func(p *ElevenLabsProvider) { p.durationProbe = probe }
}

func NewElevenLabsProvider(apiKey string, opts ...ElevenLabsOption) *ElevenLabsProvider {
	voiceID := elevenLabsDefaultVoice
	if v := os.Getenv("ELEVENLABS_VOICE_ID"); v != "" {
		voiceID = v
	}
	modelID := elevenLabsDefaultModel
	if m := os.Getenv("ELEVENLABS_MODEL_ID"); m != "" {
		modelID = m
	}
	p := &ElevenLabsProvider{
		apiKey:        apiKey,
		baseURL:       elevenLabsBaseURL,
		voiceID:       voiceID,
		modelID:       modelID,
		outputFormat:  elevenLabsOutputFormat,
		httpClient:    &http.Client{Timeout: elevenLabsRequestTimeout},
		durationProbe: FFProbeDuration("ffprobe"),
	}
	for _, opt := range opts {
		opt(p)
	}
	return p
}

type elevenLabsRequest struct {
	Text    string `json:"text"`
	ModelID string `json:"model_id"`
}

// Synthesize calls the ElevenLabs text-to-speech endpoint, which returns the
// mp3 audio bytes synchronously (unlike FPT's async poll). req.Voice/req.Speed
// are accepted for interface parity but not applied: voice is fixed to the
// configured ElevenLabs voice ID and this model has no speed control.
func (p *ElevenLabsProvider) Synthesize(ctx context.Context, req SynthesizeRequest, destPath string) (SynthesizeResult, error) {
	chars := len([]rune(req.Text))
	if chars < minChars || chars > maxChars {
		return SynthesizeResult{}, fmt.Errorf("text length %d chars, must be %d-%d", chars, minChars, maxChars)
	}

	body, err := json.Marshal(elevenLabsRequest{Text: req.Text, ModelID: p.modelID})
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("marshal elevenlabs request: %w", err)
	}

	url := fmt.Sprintf("%s/v1/text-to-speech/%s?output_format=%s", p.baseURL, p.voiceID, p.outputFormat)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("build elevenlabs request: %w", err)
	}
	httpReq.Header.Set("xi-api-key", p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "audio/mpeg")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("elevenlabs tts request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return SynthesizeResult{}, fmt.Errorf("ElevenLabs TTS rejected request (status %d): %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	audio, err := io.ReadAll(resp.Body)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("read elevenlabs audio: %w", err)
	}
	if err := os.WriteFile(destPath, audio, 0o644); err != nil {
		return SynthesizeResult{}, fmt.Errorf("write audio to %s: %w", destPath, err)
	}

	duration, err := p.durationProbe(ctx, destPath)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("probe duration of %s: %w", destPath, err)
	}

	return SynthesizeResult{
		AudioPath:    destPath,
		DurationSec:  duration,
		CharsCharged: chars,
	}, nil
}
