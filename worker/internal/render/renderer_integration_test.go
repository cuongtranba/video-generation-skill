//go:build integration

package render

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// requires ffmpeg + ffprobe on PATH; run with: go test -tags=integration ./internal/render/...

func genTestVideo(t *testing.T, dir string, seconds float64) string {
	t.Helper()
	path := filepath.Join(dir, "test_clip.mp4")
	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", fmt.Sprintf("testsrc=duration=%.1f:size=640x360:rate=30", seconds),
		"-pix_fmt", "yuv420p", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("gen test video: %v: %s", err, out)
	}
	return path
}

func genTestImage(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "test_img.png")
	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=duration=0.1:size=1280x720:rate=1",
		"-frames:v", "1", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("gen test image: %v: %s", err, out)
	}
	return path
}

func genTestAudio(t *testing.T, dir string, name string, seconds float64) string {
	t.Helper()
	path := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=440:duration=%.1f", seconds),
		"-c:a", "libmp3lame", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("gen test audio: %v: %s", err, out)
	}
	return path
}

const testASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,64,&H00FFFFFF,&H00FFFF00,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{\k40}Xin {\k50}chào {\k50}Việt {\k50}Nam
`

func TestRenderEndToEnd(t *testing.T) {
	dir := t.TempDir()
	clip := genTestVideo(t, dir, 3)
	img := genTestImage(t, dir)
	audio0 := genTestAudio(t, dir, "v0.mp3", 3)
	audio1 := genTestAudio(t, dir, "v1.mp3", 2)

	assPath := filepath.Join(dir, "captions.ass")
	if err := os.WriteFile(assPath, []byte(testASS), 0o644); err != nil {
		t.Fatalf("write ass: %v", err)
	}

	out := filepath.Join(dir, "out.mp4")
	r := NewFFmpegRenderer("ffmpeg", "ffprobe")
	res, err := r.Render(context.Background(), RenderRequest{
		Scenes: []SceneInput{
			{MediaPath: clip, AudioPath: audio0, DurationSec: 3},
			{MediaPath: img, AudioPath: audio1, IsImage: true, DurationSec: 2},
		},
		ASSPath:    assPath,
		OutputPath: out,
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	if res.DurationSec < 4.5 || res.DurationSec > 5.5 {
		t.Errorf("duration = %v, want ~5s", res.DurationSec)
	}
	if res.FileSizeBytes == 0 {
		t.Error("output file empty")
	}

	// verify 1080x1920
	probe := exec.Command("ffprobe", "-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=s=x:p=0", out)
	dims, err := probe.Output()
	if err != nil {
		t.Fatalf("probe dims: %v", err)
	}
	if got := string(dims); got != "1080x1920\n" {
		t.Errorf("dimensions = %q, want 1080x1920", got)
	}
}
