package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"

	"gopkg.in/yaml.v3"
)

// ProvidersConfig selects which provider implements each pipeline category.
// Secrets never live here — API keys come from Config (.env / env vars).
type ProvidersConfig struct {
	TTS      TTSSelect      `yaml:"tts"`
	Music    MusicSelect    `yaml:"music"`
	Material MaterialSelect `yaml:"material"`
	VideoGen VideoGenSelect `yaml:"videogen"`
	Publish  PublishSelect  `yaml:"publish"`
}

type TTSSelect struct {
	Provider string `yaml:"provider"`
	Voice    string `yaml:"voice"`
	Speed    int    `yaml:"speed"`
}

type MusicSelect struct {
	Provider string `yaml:"provider"`
}

type MaterialSelect struct {
	Providers []string `yaml:"providers"`
}

type VideoGenSelect struct {
	Provider string `yaml:"provider"`
}

type PublishSelect struct {
	Provider string `yaml:"provider"`
}

func DefaultProvidersConfig() ProvidersConfig {
	return ProvidersConfig{
		TTS:      TTSSelect{Provider: "elevenlabs", Voice: "banmai", Speed: 0},
		Music:    MusicSelect{Provider: "jamendo"},
		Material: MaterialSelect{Providers: []string{"pexels", "pixabay"}},
		VideoGen: VideoGenSelect{Provider: "none"},
		Publish:  PublishSelect{Provider: "none"},
	}
}

// LoadProviders reads a YAML config file, filling any unset field from
// DefaultProvidersConfig. An absent file yields pure defaults (no error).
func LoadProviders(path string) (ProvidersConfig, error) {
	cfg := DefaultProvidersConfig()
	if path == "" {
		return cfg, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return cfg, nil
		}
		return ProvidersConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return ProvidersConfig{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	return fillDefaults(cfg), nil
}

func fillDefaults(cfg ProvidersConfig) ProvidersConfig {
	d := DefaultProvidersConfig()
	if cfg.TTS.Provider == "" {
		cfg.TTS.Provider = d.TTS.Provider
	}
	if cfg.TTS.Voice == "" {
		cfg.TTS.Voice = d.TTS.Voice
	}
	// TTS.Speed is intentionally not backfilled here: its zero value (0)
	// already equals DefaultProvidersConfig's value, and 0 is also a valid
	// explicit user setting, so a "Speed == 0" guard would wrongly override
	// a deliberate user choice.
	if cfg.Music.Provider == "" {
		cfg.Music.Provider = d.Music.Provider
	}
	if len(cfg.Material.Providers) == 0 {
		cfg.Material.Providers = d.Material.Providers
	}
	if cfg.VideoGen.Provider == "" {
		cfg.VideoGen.Provider = d.VideoGen.Provider
	}
	if cfg.Publish.Provider == "" {
		cfg.Publish.Provider = d.Publish.Provider
	}
	return cfg
}
