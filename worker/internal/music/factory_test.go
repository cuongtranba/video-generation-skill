package music

import (
	"context"
	"strings"
	"testing"

	"github.com/cuongtranba/video-generation-skill/worker/internal/config"
)

func TestNewFromConfig(t *testing.T) {
	tests := []struct {
		name        string
		provider    string
		wantJamendo bool
		wantNoop    bool
		wantErrSub  string
	}{
		{"jamendo", "jamendo", true, false, ""},
		{"none", "none", false, true, ""},
		{"unknown", "spotify", false, false, "unknown music provider"},
		{"empty", "", false, false, "unknown music provider"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, err := NewFromConfig(config.MusicSelect{Provider: tt.provider}, "cid")
			if tt.wantErrSub != "" {
				if err == nil {
					t.Fatalf("want error containing %q, got nil", tt.wantErrSub)
				}
				if !strings.Contains(err.Error(), tt.wantErrSub) {
					t.Errorf("error = %q, want substring %q", err, tt.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewFromConfig: %v", err)
			}
			if tt.wantJamendo {
				if _, ok := s.(*JamendoSource); !ok {
					t.Errorf("want *JamendoSource, got %T", s)
				}
			}
			if tt.wantNoop {
				tracks, err := s.Search(context.Background(), Query{Tags: "chill"})
				if err != nil {
					t.Fatalf("noop Search: %v", err)
				}
				if len(tracks) != 0 {
					t.Errorf("none source should return 0 tracks, got %d", len(tracks))
				}
			}
		})
	}
}

func TestNoopSourceDownloadErrors(t *testing.T) {
	s, err := NewFromConfig(config.MusicSelect{Provider: "none"}, "")
	if err != nil {
		t.Fatalf("NewFromConfig: %v", err)
	}
	if err := s.Download(context.Background(), Track{}, "/tmp/x.mp3"); err == nil {
		t.Fatal("noop Download should return an error")
	}
}
