package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFromEnvVars(t *testing.T) {
	t.Setenv("FPT_TTS_API_KEY", "fpt-key")
	t.Setenv("PEXELS_API_KEY", "pexels-key")
	t.Setenv("PIXABAY_API_KEY", "pixabay-key")

	cfg, err := Load("")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FPTTTSAPIKey != "fpt-key" {
		t.Errorf("FPTTTSAPIKey = %q", cfg.FPTTTSAPIKey)
	}
	if cfg.PexelsAPIKey != "pexels-key" {
		t.Errorf("PexelsAPIKey = %q", cfg.PexelsAPIKey)
	}
	if cfg.PixabayAPIKey != "pixabay-key" {
		t.Errorf("PixabayAPIKey = %q", cfg.PixabayAPIKey)
	}
}

func TestLoadFromDotEnvFile(t *testing.T) {
	t.Setenv("FPT_TTS_API_KEY", "")
	t.Setenv("PEXELS_API_KEY", "")
	os.Unsetenv("FPT_TTS_API_KEY")
	os.Unsetenv("PEXELS_API_KEY")

	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "FPT_TTS_API_KEY=file-fpt\nPEXELS_API_KEY=file-pexels\n# comment\n\nEXTRA=x\n"
	if err := os.WriteFile(envPath, []byte(content), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg, err := Load(envPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FPTTTSAPIKey != "file-fpt" {
		t.Errorf("FPTTTSAPIKey = %q, want file-fpt", cfg.FPTTTSAPIKey)
	}
	if cfg.PexelsAPIKey != "file-pexels" {
		t.Errorf("PexelsAPIKey = %q, want file-pexels", cfg.PexelsAPIKey)
	}
}

func TestEnvVarOverridesDotEnv(t *testing.T) {
	t.Setenv("FPT_TTS_API_KEY", "env-wins")

	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	if err := os.WriteFile(envPath, []byte("FPT_TTS_API_KEY=file-loses\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	cfg, err := Load(envPath)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FPTTTSAPIKey != "env-wins" {
		t.Errorf("FPTTTSAPIKey = %q, want env-wins", cfg.FPTTTSAPIKey)
	}
}

func TestValidateForGenerate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{"all set", Config{FPTTTSAPIKey: "a", PexelsAPIKey: "b"}, false},
		{"missing fpt", Config{PexelsAPIKey: "b"}, true},
		{"missing pexels", Config{FPTTTSAPIKey: "a"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.ValidateForGenerate()
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateForGenerate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
