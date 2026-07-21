package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFromEnvVars(t *testing.T) {
	t.Setenv("ELEVENLABS_API_KEY", "eleven-key")
	t.Setenv("PEXELS_API_KEY", "pexels-key")
	t.Setenv("PIXABAY_API_KEY", "pixabay-key")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ElevenLabsAPIKey != "eleven-key" {
		t.Errorf("ElevenLabsAPIKey = %q", cfg.ElevenLabsAPIKey)
	}
	if cfg.PexelsAPIKey != "pexels-key" {
		t.Errorf("PexelsAPIKey = %q", cfg.PexelsAPIKey)
	}
	if cfg.PixabayAPIKey != "pixabay-key" {
		t.Errorf("PixabayAPIKey = %q", cfg.PixabayAPIKey)
	}
}

func TestLoadFromDotEnvFile(t *testing.T) {
	t.Setenv("ELEVENLABS_API_KEY", "")
	t.Setenv("PEXELS_API_KEY", "")
	os.Unsetenv("ELEVENLABS_API_KEY")
	os.Unsetenv("PEXELS_API_KEY")

	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "ELEVENLABS_API_KEY=file-eleven\nPEXELS_API_KEY=file-pexels\n# comment\n\nEXTRA=x\n"
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg, err := Load(envPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ElevenLabsAPIKey != "file-eleven" {
		t.Errorf("ElevenLabsAPIKey = %q, want file-eleven", cfg.ElevenLabsAPIKey)
	}
	if cfg.PexelsAPIKey != "file-pexels" {
		t.Errorf("PexelsAPIKey = %q, want file-pexels", cfg.PexelsAPIKey)
	}
}

func TestEnvVarOverridesDotEnv(t *testing.T) {
	t.Setenv("ELEVENLABS_API_KEY", "env-wins")

	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("ELEVENLABS_API_KEY=file-loses\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg, err := Load(envPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ElevenLabsAPIKey != "env-wins" {
		t.Errorf("ElevenLabsAPIKey = %q, want env-wins", cfg.ElevenLabsAPIKey)
	}
}

func TestValidateForProvidersMusicNoneSkipsJamendo(t *testing.T) {
	cfg := Config{ElevenLabsAPIKey: "k", PexelsAPIKey: "p", PixabayAPIKey: "x"}
	providers := DefaultProvidersConfig()
	providers.Music.Provider = "none"
	if err := cfg.ValidateForProviders(providers); err != nil {
		t.Errorf("music=none should not require jamendo key: %v", err)
	}
}

func TestValidateForProvidersMissingSelectedKey(t *testing.T) {
	cfg := Config{PexelsAPIKey: "p"} // no ElevenLabs key
	providers := DefaultProvidersConfig()
	if err := cfg.ValidateForProviders(providers); err == nil {
		t.Fatal("want error for missing ELEVENLABS_API_KEY when tts=elevenlabs")
	}
}

func TestValidateForProvidersOnlyListedMaterial(t *testing.T) {
	cfg := Config{ElevenLabsAPIKey: "k", PexelsAPIKey: "p"} // no pixabay key
	providers := DefaultProvidersConfig()
	providers.Material.Providers = []string{"pexels"}
	providers.Music.Provider = "none"
	if err := cfg.ValidateForProviders(providers); err != nil {
		t.Errorf("only pexels selected, pixabay key not required: %v", err)
	}
}
