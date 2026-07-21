package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultProvidersConfig(t *testing.T) {
	got := DefaultProvidersConfig()
	if got.TTS.Provider != "elevenlabs" || got.TTS.Voice != "banmai" {
		t.Errorf("tts default = %+v", got.TTS)
	}
	if got.Music.Provider != "jamendo" {
		t.Errorf("music default = %q", got.Music.Provider)
	}
	if len(got.Material.Providers) != 2 || got.Material.Providers[0] != "pexels" {
		t.Errorf("material default = %v", got.Material.Providers)
	}
	if got.VideoGen.Provider != "none" || got.Publish.Provider != "none" {
		t.Errorf("videogen/publish default = %q/%q", got.VideoGen.Provider, got.Publish.Provider)
	}
}

func TestLoadProvidersAbsentFileReturnsDefaults(t *testing.T) {
	got, err := LoadProviders(filepath.Join(t.TempDir(), "nope.yaml"))
	if err != nil {
		t.Fatalf("LoadProviders: %v", err)
	}
	if got.TTS.Provider != "elevenlabs" {
		t.Errorf("want defaults, got %+v", got)
	}
}

func TestLoadProvidersPartialFillsFromDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("publish:\n  provider: tiktok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadProviders(path)
	if err != nil {
		t.Fatalf("LoadProviders: %v", err)
	}
	if got.Publish.Provider != "tiktok" {
		t.Errorf("publish = %q, want tiktok", got.Publish.Provider)
	}
	if got.TTS.Provider != "elevenlabs" {
		t.Errorf("tts should fill from default, got %q", got.TTS.Provider)
	}
	if len(got.Material.Providers) != 2 {
		t.Errorf("material should fill from default, got %v", got.Material.Providers)
	}
}

func TestLoadProvidersNullSectionFillsFromDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("tts:\nmusic:\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadProviders(path)
	if err != nil {
		t.Fatalf("LoadProviders: %v", err)
	}
	if got.TTS.Provider != "elevenlabs" || got.TTS.Voice != "banmai" {
		t.Errorf("null tts section should fill from defaults, got %+v", got.TTS)
	}
	if got.Music.Provider != "jamendo" {
		t.Errorf("null music section should fill from defaults, got %q", got.Music.Provider)
	}
}

func TestLoadProvidersMalformedYAML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.yaml")
	if err := os.WriteFile(path, []byte("tts: [not a map\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadProviders(path); err == nil {
		t.Fatal("want error for malformed yaml")
	}
}
