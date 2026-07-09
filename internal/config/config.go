package config

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

type Config struct {
	FPTTTSAPIKey      string
	PexelsAPIKey      string
	PixabayAPIKey     string
	JamendoClientID   string
	TikTokAccessToken string
}

// Load reads configuration from a .env file (if envPath is non-empty and the
// file exists) with real environment variables taking precedence.
func Load(envPath string) (Config, error) {
	fileVals, err := parseDotEnv(envPath)
	if err != nil {
		return Config{}, err
	}

	get := func(key string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fileVals[key]
	}

	return Config{
		FPTTTSAPIKey:      get("FPT_TTS_API_KEY"),
		PexelsAPIKey:      get("PEXELS_API_KEY"),
		PixabayAPIKey:     get("PIXABAY_API_KEY"),
		JamendoClientID:   get("JAMENDO_CLIENT_ID"),
		TikTokAccessToken: get("TIKTOK_ACCESS_TOKEN"),
	}, nil
}

func (c Config) ValidateForGenerate() error {
	var missing []string
	if c.FPTTTSAPIKey == "" {
		missing = append(missing, "FPT_TTS_API_KEY")
	}
	if c.PexelsAPIKey == "" {
		missing = append(missing, "PEXELS_API_KEY")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required config: %s", strings.Join(missing, ", "))
	}
	return nil
}

// ValidateForProviders checks that every credential required by the SELECTED
// providers is present. Unselected providers' keys are not required.
func (c Config) ValidateForProviders(p ProvidersConfig) error {
	var missing []string

	switch p.TTS.Provider {
	case "fpt":
		if c.FPTTTSAPIKey == "" {
			missing = append(missing, "FPT_TTS_API_KEY")
		}
	}

	for _, name := range p.Material.Providers {
		switch name {
		case "pexels":
			if c.PexelsAPIKey == "" {
				missing = append(missing, "PEXELS_API_KEY")
			}
		case "pixabay":
			if c.PixabayAPIKey == "" {
				missing = append(missing, "PIXABAY_API_KEY")
			}
		}
	}

	if p.Music.Provider == "jamendo" && c.JamendoClientID == "" {
		missing = append(missing, "JAMENDO_CLIENT_ID")
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required config for selected providers: %s", strings.Join(missing, ", "))
	}
	return nil
}

func parseDotEnv(path string) (map[string]string, error) {
	vals := map[string]string{}
	if path == "" {
		return vals, nil
	}

	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return vals, nil
		}
		return nil, fmt.Errorf("open env file %s: %w", path, err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		vals[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read env file %s: %w", path, err)
	}
	return vals, nil
}
