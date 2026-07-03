package script

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/cuongtranba/video-generation-skill/internal/domain"
)

type ResourceAsset struct {
	Path        string  `json:"path"`
	Type        string  `json:"type"`
	DurationSec float64 `json:"duration_sec,omitempty"`
}

type GenerateRequest struct {
	Idea              string
	DurationSec       int
	Tone              string
	SceneCount        int // 0 = model decides
	ResourceInventory []ResourceAsset
}

type GenerateResult struct {
	Scenes []domain.Scene
}

type Generator interface {
	Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error)
}

var _ Generator = (*ClaudeCLIGenerator)(nil)

// ClaudeCLIGenerator produces scene scripts by invoking the claude CLI in
// headless print mode, using the local subscription auth (no API key).
type ClaudeCLIGenerator struct {
	bin string
}

func NewClaudeCLIGenerator(bin string) *ClaudeCLIGenerator {
	return &ClaudeCLIGenerator{bin: bin}
}

// cliEnvelope is the claude CLI --output-format json result wrapper.
type cliEnvelope struct {
	Type    string `json:"type"`
	IsError bool   `json:"is_error"`
	Result  string `json:"result"`
}

// rawScene is the JSON shape the prompt instructs the model to emit.
type rawScene struct {
	Narration  string `json:"narration"`
	VisualNote string `json:"visual_note"`
}

func (g *ClaudeCLIGenerator) Generate(ctx context.Context, req GenerateRequest) (GenerateResult, error) {
	prompt := buildPrompt(req)

	cmd := exec.CommandContext(ctx, g.bin, "-p", prompt, "--output-format", "json")
	out, err := cmd.Output()
	if err != nil {
		return GenerateResult{}, fmt.Errorf("run claude CLI for idea %q: %w", req.Idea, err)
	}

	env, err := parseEnvelope(out)
	if err != nil {
		return GenerateResult{}, err
	}
	if env.IsError {
		return GenerateResult{}, fmt.Errorf("claude CLI returned error result: %s", truncate(env.Result, 200))
	}

	payload := stripFences(env.Result)

	var raw []rawScene
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return GenerateResult{}, fmt.Errorf("parse scenes JSON from claude output %q: %w", truncate(payload, 200), err)
	}
	if len(raw) == 0 {
		return GenerateResult{}, fmt.Errorf("claude returned zero scenes for idea %q", req.Idea)
	}

	scenes := make([]domain.Scene, 0, len(raw))
	for i, r := range raw {
		if strings.TrimSpace(r.Narration) == "" {
			return GenerateResult{}, fmt.Errorf("scene %d has empty narration", i)
		}
		scenes = append(scenes, domain.Scene{
			Index:      i,
			Narration:  strings.TrimSpace(r.Narration),
			VisualNote: strings.TrimSpace(r.VisualNote),
		})
	}
	return GenerateResult{Scenes: scenes}, nil
}

// parseEnvelope handles both claude CLI output shapes: a single result
// object, or an array of message objects ending with a type=="result" entry.
func parseEnvelope(out []byte) (cliEnvelope, error) {
	var env cliEnvelope
	if err := json.Unmarshal(out, &env); err == nil && env.Type != "" {
		return env, nil
	}

	var msgs []cliEnvelope
	if err := json.Unmarshal(out, &msgs); err != nil {
		return cliEnvelope{}, fmt.Errorf("parse claude CLI envelope: %w", err)
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Type == "result" {
			return msgs[i], nil
		}
	}
	return cliEnvelope{}, fmt.Errorf("claude CLI output has no result message (%d messages)", len(msgs))
}

func buildPrompt(req GenerateRequest) string {
	var b strings.Builder
	b.WriteString("You are a Vietnamese short-form video scriptwriter. ")
	b.WriteString("Write a scene-by-scene script for a vertical (9:16) social video.\n\n")
	fmt.Fprintf(&b, "Idea: %s\n", req.Idea)
	fmt.Fprintf(&b, "Target duration: %d seconds total narration when spoken at normal pace.\n", req.DurationSec)
	if req.Tone != "" {
		fmt.Fprintf(&b, "Tone: %s\n", req.Tone)
	}
	if req.SceneCount > 0 {
		fmt.Fprintf(&b, "Scene count: exactly %d scenes.\n", req.SceneCount)
	} else {
		b.WriteString("Scene count: choose what fits the duration (typically 3-7).\n")
	}

	if len(req.ResourceInventory) > 0 {
		b.WriteString("\nThe user provided these media assets. Shape scenes around them; when a scene should use one, put its exact path in visual_note prefixed with 'asset:'.\n")
		for _, a := range req.ResourceInventory {
			if a.DurationSec > 0 {
				fmt.Fprintf(&b, "- %s (%s, %.1fs)\n", a.Path, a.Type, a.DurationSec)
			} else {
				fmt.Fprintf(&b, "- %s (%s)\n", a.Path, a.Type)
			}
		}
	}

	b.WriteString(`
Rules:
- narration: natural spoken Vietnamese, no emoji, no stage directions.
- visual_note: short ENGLISH stock-footage search phrase (or 'asset:<path>' for a provided asset).
- Output ONLY a JSON array, no markdown, no commentary:
[{"narration":"...","visual_note":"..."}]
`)
	return b.String()
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		s = strings.TrimPrefix(s, "```json")
		s = strings.TrimPrefix(s, "```")
		s = strings.TrimSuffix(strings.TrimSpace(s), "```")
	}
	return strings.TrimSpace(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
