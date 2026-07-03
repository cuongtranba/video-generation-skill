package render

import (
	"strings"
	"testing"
)

func TestBuildSingleVideoScene(t *testing.T) {
	b := NewFilterGraphBuilder()
	graph, err := b.Build([]SceneInput{
		{MediaPath: "/a/clip.mp4", AudioPath: "/a/voice0.mp3", IsImage: false, DurationSec: 5.0},
	}, "/a/captions.ass")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	wantInputs := []string{"/a/clip.mp4", "/a/voice0.mp3"}
	if len(graph.InputPaths) != 2 || graph.InputPaths[0] != wantInputs[0] || graph.InputPaths[1] != wantInputs[1] {
		t.Errorf("InputPaths = %v, want %v", graph.InputPaths, wantInputs)
	}

	fc := graph.FilterComplex
	for _, want := range []string{
		"[0:v]", "trim=duration=5.000", "scale=1080:1920", "crop=1080:1920",
		"concat=n=1:v=1:a=0", "[1:a]", "concat=n=1:v=0:a=1",
		"ass=", "captions.ass",
	} {
		if !strings.Contains(fc, want) {
			t.Errorf("filter complex missing %q\n%s", want, fc)
		}
	}
	if len(graph.OutputMaps) != 2 {
		t.Errorf("OutputMaps = %v", graph.OutputMaps)
	}
}

func TestBuildImageSceneUsesKenBurns(t *testing.T) {
	b := NewFilterGraphBuilder()
	graph, err := b.Build([]SceneInput{
		{MediaPath: "/a/photo.jpg", AudioPath: "/a/voice0.mp3", IsImage: true, DurationSec: 4.2},
	}, "/a/c.ass")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	fc := graph.FilterComplex
	if !strings.Contains(fc, "zoompan") {
		t.Errorf("image scene should use zoompan\n%s", fc)
	}
	if !strings.Contains(fc, "s=1080x1920") {
		t.Errorf("zoompan should target 1080x1920\n%s", fc)
	}

	// single-frame input: no -loop (zoompan d= extends duration)
	joined := strings.Join(graph.InputArgs, " ")
	if strings.Contains(joined, "-loop") {
		t.Errorf("image input must not loop: %s", joined)
	}
	if !strings.Contains(fc, "d=126") { // 4.2s * 30fps
		t.Errorf("zoompan should extend to 126 frames\n%s", fc)
	}
}

func TestBuildMixedScenes(t *testing.T) {
	b := NewFilterGraphBuilder()
	graph, err := b.Build([]SceneInput{
		{MediaPath: "/a/clip.mp4", AudioPath: "/a/v0.mp3", DurationSec: 3},
		{MediaPath: "/a/img.jpg", AudioPath: "/a/v1.mp3", IsImage: true, DurationSec: 4},
		{MediaPath: "/a/clip2.mp4", AudioPath: "/a/v2.mp3", DurationSec: 5},
	}, "/a/c.ass")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	fc := graph.FilterComplex
	for _, want := range []string{
		"concat=n=3:v=1:a=0",
		"concat=n=3:v=0:a=1",
		"[0:v]", "[2:v]", "[4:v]", // media inputs at even indexes
		"[1:a]", "[3:a]", "[5:a]", // audio inputs at odd indexes
	} {
		if !strings.Contains(fc, want) {
			t.Errorf("filter complex missing %q\n%s", want, fc)
		}
	}
	if len(graph.InputPaths) != 6 {
		t.Errorf("InputPaths = %d, want 6", len(graph.InputPaths))
	}
}

func TestBuildNoScenes(t *testing.T) {
	if _, err := NewFilterGraphBuilder().Build(nil, "/a/c.ass"); err == nil {
		t.Fatal("want error for zero scenes")
	}
}

func TestBuildNoSubtitles(t *testing.T) {
	graph, err := NewFilterGraphBuilder().Build([]SceneInput{
		{MediaPath: "/a/clip.mp4", AudioPath: "/a/v.mp3", DurationSec: 3},
	}, "")
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if strings.Contains(graph.FilterComplex, "ass=") {
		t.Error("should not include ass filter when no subtitle path")
	}
}

func TestEscapeFilterPath(t *testing.T) {
	tests := []struct{ in, want string }{
		{"/plain/path.ass", "/plain/path.ass"},
		{"/with:colon.ass", `/with\:colon.ass`},
		{"/with'quote.ass", `/with\'quote.ass`},
	}
	for _, tt := range tests {
		if got := escapeFilterPath(tt.in); got != tt.want {
			t.Errorf("escapeFilterPath(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
