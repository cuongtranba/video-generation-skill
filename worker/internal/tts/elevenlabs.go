package tts

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/cuongtranba/video-generation-skill/worker/internal/caption"
)

const (
	elevenLabsBaseURL = "https://api.elevenlabs.io"
	// Default voice ID. A Vietnamese-capable voice so multilingual_v2 speaks
	// Vietnamese narration natively; override per deployment with
	// ELEVENLABS_VOICE_ID. ElevenLabs selects the voice by ID — the voice/speed
	// tune fields are not applied.
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
// mp3 audio bytes synchronously. req.Voice/req.Speed
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

	url := fmt.Sprintf("%s/v1/text-to-speech/%s/with-timestamps?output_format=%s", p.baseURL, p.voiceID, p.outputFormat)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("build elevenlabs request: %w", err)
	}
	httpReq.Header.Set("xi-api-key", p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("elevenlabs tts request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return SynthesizeResult{}, fmt.Errorf("ElevenLabs TTS rejected request (status %d): %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}

	var tsResp elevenLabsTimestampResponse
	if err := json.NewDecoder(resp.Body).Decode(&tsResp); err != nil {
		return SynthesizeResult{}, fmt.Errorf("decode elevenlabs timestamps response: %w", err)
	}
	audio, err := base64.StdEncoding.DecodeString(tsResp.AudioBase64)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("decode elevenlabs audio_base64: %w", err)
	}
	if err := os.WriteFile(destPath, audio, 0o644); err != nil {
		return SynthesizeResult{}, fmt.Errorf("write audio to %s: %w", destPath, err)
	}

	wordsPath, err := writeWordsSidecar(destPath, tsResp.alignmentWords())
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("write words sidecar for %s: %w", destPath, err)
	}

	duration, err := p.durationProbe(ctx, destPath)
	if err != nil {
		return SynthesizeResult{}, fmt.Errorf("probe duration of %s: %w", destPath, err)
	}

	return SynthesizeResult{
		AudioPath:    destPath,
		DurationSec:  duration,
		CharsCharged: chars,
		WordsPath:    wordsPath,
	}, nil
}

type elevenLabsTimestampResponse struct {
	AudioBase64         string               `json:"audio_base64"`
	Alignment           *elevenLabsAlignment `json:"alignment"`
	NormalizedAlignment *elevenLabsAlignment `json:"normalized_alignment"`
}

// alignmentWords prefers the literal alignment (matches the narration text the
// caption aligner expects) and falls back to the normalized alignment.
func (r elevenLabsTimestampResponse) alignmentWords() []caption.WordTimestamp {
	if w := wordsFromAlignment(r.Alignment); len(w) > 0 {
		return w
	}
	return wordsFromAlignment(r.NormalizedAlignment)
}

// writeWordsSidecar atomically writes words next to destPath as a .words.json
// sidecar. When there are no words (API returned no usable alignment) it writes
// nothing and returns an empty path — the caption stage will then fail loudly.
func writeWordsSidecar(destPath string, words []caption.WordTimestamp) (string, error) {
	if len(words) == 0 {
		return "", nil
	}
	path := caption.WordsSidecarPath(destPath)
	data, err := json.Marshal(caption.WordsSidecar{Words: words})
	if err != nil {
		return "", fmt.Errorf("marshal words sidecar: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", fmt.Errorf("write temp sidecar %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("rename sidecar %s: %w", path, err)
	}
	return path, nil
}
