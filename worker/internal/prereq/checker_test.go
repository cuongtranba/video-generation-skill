package prereq

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeFakeBin(t *testing.T, dir, name, output string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake bin helper is unix-only")
	}
	path := filepath.Join(dir, name)
	script := "#!/bin/sh\necho \"" + output + "\"\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake bin %s: %v", name, err)
	}
	return path
}

func TestCheckAllPresent(t *testing.T) {
	dir := t.TempDir()
	ffmpeg := writeFakeBin(t, dir, "ffmpeg", "ffmpeg version 6.1.1 Copyright")
	ffprobe := writeFakeBin(t, dir, "ffprobe", "ffprobe version 6.1.1 Copyright")
	whisper := writeFakeBin(t, dir, "whisper", "usage: whisper")

	t.Setenv("FFMPEG_BIN", ffmpeg)
	t.Setenv("FFPROBE_BIN", ffprobe)
	t.Setenv("WHISPER_BIN", whisper)

	c := NewChecker()
	if err := c.Check(); err != nil {
		t.Fatalf("Check: %v", err)
	}

	got, err := c.Resolve("ffmpeg")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != ffmpeg {
		t.Errorf("Resolve(ffmpeg) = %q, want %q", got, ffmpeg)
	}
}

func TestCheckMissingBinary(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FFMPEG_BIN", filepath.Join(dir, "no-such-ffmpeg"))
	t.Setenv("FFPROBE_BIN", filepath.Join(dir, "no-such-ffprobe"))
	t.Setenv("WHISPER_BIN", filepath.Join(dir, "no-such-whisper"))

	err := NewChecker().Check()
	if err == nil {
		t.Fatal("Check: want error for missing binaries, got nil")
	}
	for _, name := range []string{"ffmpeg", "ffprobe", "whisper"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error should mention %q: %v", name, err)
		}
	}
}

func TestCheckOutdatedVersion(t *testing.T) {
	dir := t.TempDir()
	ffmpeg := writeFakeBin(t, dir, "ffmpeg", "ffmpeg version 4.4.1 Copyright")
	ffprobe := writeFakeBin(t, dir, "ffprobe", "ffprobe version 6.1.1 Copyright")
	whisper := writeFakeBin(t, dir, "whisper", "usage: whisper")

	t.Setenv("FFMPEG_BIN", ffmpeg)
	t.Setenv("FFPROBE_BIN", ffprobe)
	t.Setenv("WHISPER_BIN", whisper)

	err := NewChecker().Check()
	if err == nil {
		t.Fatal("Check: want error for outdated ffmpeg, got nil")
	}
	if !strings.Contains(err.Error(), "ffmpeg") {
		t.Errorf("error should mention ffmpeg: %v", err)
	}
}

func TestResolveUnknown(t *testing.T) {
	if _, err := NewChecker().Resolve("unknown-tool"); err == nil {
		t.Fatal("Resolve(unknown): want error, got nil")
	}
}
