package worker

import (
	"github.com/cuongtranba/video-generation-skill/internal/domain"
	"github.com/cuongtranba/video-generation-skill/internal/render"
)

type TTSJob struct {
	ProjectID  string       `json:"project_id"`
	SceneIndex int          `json:"scene_index"`
	Text       string       `json:"text"`
	Voice      domain.Voice `json:"voice"`
	Speed      domain.Speed `json:"speed"`
	DestPath   string       `json:"dest_path"`
}

type TTSResult struct {
	ProjectID    string  `json:"project_id"`
	SceneIndex   int     `json:"scene_index"`
	AudioPath    string  `json:"audio_path"`
	DurationSec  float64 `json:"duration_sec"`
	CharsCharged int     `json:"chars_charged"`
	Error        string  `json:"error,omitempty"`
}

type MaterialJob struct {
	ProjectID      string `json:"project_id"`
	SceneIndex     int    `json:"scene_index"`
	Query          string `json:"query"`
	LocalAssetPath string `json:"local_asset_path,omitempty"`
	DestPath       string `json:"dest_path"`
}

type MaterialResult struct {
	ProjectID  string  `json:"project_id"`
	SceneIndex int     `json:"scene_index"`
	MediaPath  string  `json:"media_path"`
	IsImage    bool    `json:"is_image"`
	DurationSec float64 `json:"duration_sec"`
	Error      string  `json:"error,omitempty"`
}

// SceneAudioRef locates one scene's voiceover inside the final timeline.
type SceneAudioRef struct {
	AudioPath      string  `json:"audio_path"`
	StartOffsetSec float64 `json:"start_offset_sec"`
}

type CaptionJob struct {
	ProjectID  string          `json:"project_id"`
	SceneAudio []SceneAudioRef `json:"scene_audio"`
	Style      domain.CaptionStyle `json:"style"`
	DestPath   string          `json:"dest_path"`
}

type CaptionResult struct {
	ProjectID string `json:"project_id"`
	ASSPath   string `json:"ass_path"`
	Error     string `json:"error,omitempty"`
}

type RenderJob struct {
	ProjectID  string              `json:"project_id"`
	Scenes     []render.SceneInput `json:"scenes"`
	ASSPath    string              `json:"ass_path"`
	OutputPath string              `json:"output_path"`
}

type RenderResult struct {
	ProjectID     string  `json:"project_id"`
	OutputPath    string  `json:"output_path"`
	DurationSec   float64 `json:"duration_sec"`
	FileSizeBytes int64   `json:"file_size_bytes"`
	Error         string  `json:"error,omitempty"`
}
