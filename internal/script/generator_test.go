package script

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeFakeClaude creates a shell script that emits the claude CLI json
// envelope with the given result payload.
func writeFakeClaude(t *testing.T, result string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	envelope := `{"type":"result","subtype":"success","is_error":false,"result":` + result + `}`
	script := "#!/bin/sh\ncat > /dev/null\ncat <<'FAKE_EOF'\n" + envelope + "\nFAKE_EOF\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	return path
}

const scenesJSON = `"[{\"narration\":\"Nước ấm giúp tiêu hóa tốt hơn.\",\"visual_note\":\"warm water glass morning\"},{\"narration\":\"Uống ngay khi thức dậy.\",\"visual_note\":\"person waking up sunrise\"}]"`

func TestGenerateParsesScenes(t *testing.T) {
	bin := writeFakeClaude(t, scenesJSON)
	g := NewClaudeCLIGenerator(bin)

	res, err := g.Generate(context.Background(), GenerateRequest{
		Idea:        "lợi ích nước ấm",
		DurationSec: 30,
		Tone:        "casual",
		SceneCount:  2,
	})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(res.Scenes) != 2 {
		t.Fatalf("scenes = %d, want 2", len(res.Scenes))
	}
	if res.Scenes[0].Index != 0 || res.Scenes[1].Index != 1 {
		t.Errorf("scene indexes = %d,%d want 0,1", res.Scenes[0].Index, res.Scenes[1].Index)
	}
	if res.Scenes[0].Narration != "Nước ấm giúp tiêu hóa tốt hơn." {
		t.Errorf("narration = %q", res.Scenes[0].Narration)
	}
	if res.Scenes[1].VisualNote != "person waking up sunrise" {
		t.Errorf("visual note = %q", res.Scenes[1].VisualNote)
	}
}

func TestGenerateStripsMarkdownFences(t *testing.T) {
	fenced := `"` + "```json\\n" + `[{\"narration\":\"A\",\"visual_note\":\"B\"}]` + "\\n```" + `"`
	bin := writeFakeClaude(t, fenced)
	g := NewClaudeCLIGenerator(bin)

	res, err := g.Generate(context.Background(), GenerateRequest{Idea: "x", DurationSec: 15})
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len(res.Scenes) != 1 || res.Scenes[0].Narration != "A" {
		t.Fatalf("scenes = %+v", res.Scenes)
	}
}

func TestGenerateEmptyScenes(t *testing.T) {
	bin := writeFakeClaude(t, `"[]"`)
	g := NewClaudeCLIGenerator(bin)

	_, err := g.Generate(context.Background(), GenerateRequest{Idea: "x", DurationSec: 15})
	if err == nil {
		t.Fatal("want error for empty scenes")
	}
}

func TestGenerateCLIFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}

	g := NewClaudeCLIGenerator(path)
	_, err := g.Generate(context.Background(), GenerateRequest{Idea: "x", DurationSec: 15})
	if err == nil {
		t.Fatal("want error for CLI exit 1")
	}
}

func TestBuildPromptIncludesResources(t *testing.T) {
	req := GenerateRequest{
		Idea:        "3 lý do uống nước ấm",
		DurationSec: 45,
		Tone:        "casual",
		SceneCount:  5,
		ResourceInventory: []ResourceAsset{
			{Path: "demo/cup.jpg", Type: "image"},
			{Path: "demo/intro.mp4", Type: "video", DurationSec: 6.5},
		},
	}
	prompt := buildPrompt(req)
	for _, want := range []string{"3 lý do uống nước ấm", "45", "casual", "demo/cup.jpg", "demo/intro.mp4"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
}
