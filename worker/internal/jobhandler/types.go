// worker/internal/jobhandler/types.go
package jobhandler

import "github.com/cuongtranba/video-generation-skill/worker/internal/domain"

// Job payload JSON contract — see plan decision #7 in the P3 plan doc: this
// plan defines these shapes since P1 (which produces them) is not yet
// authored. camelCase throughout to match the rest of the webapp's JSON
// convention (the frozen event catalogue is camelCase).

// MaterialJob resolves scene SceneIdx's stock/local media into DestPath.
type MaterialJob struct {
	ProjectID      string `json:"projectId"`
	SceneIdx       int    `json:"sceneIdx"`
	Query          string `json:"query"`
	LocalAssetPath string `json:"localAssetPath,omitempty"`
	DestPath       string `json:"destPath"`
}

// TTSJob synthesizes scene SceneIdx's narration into DestPath.
type TTSJob struct {
	ProjectID string       `json:"projectId"`
	SceneIdx  int          `json:"sceneIdx"`
	Text      string       `json:"text"`
	Voice     domain.Voice `json:"voice"`
	Speed     domain.Speed `json:"speed"`
	DestPath  string       `json:"destPath"`
}

// SceneAudioRef locates one scene's voiceover inside the final timeline,
// for caption transcription offset alignment.
type SceneAudioRef struct {
	AudioPath      string  `json:"audioPath"`
	StartOffsetSec float64 `json:"startOffsetSec"`
}

// CaptionJob transcribes every scene's audio and writes one ASS file for
// the whole project to DestPath. NOTE: Style embeds domain.CaptionStyle,
// which (unmodified, kept package) has snake_case JSON tags — see plan
// decision #7's documented inconsistency.
type CaptionJob struct {
	ProjectID  string              `json:"projectId"`
	SceneAudio []SceneAudioRef     `json:"sceneAudio"`
	Style      domain.CaptionStyle `json:"style"`
	DestPath   string              `json:"destPath"`
}

// RenderSceneJob is one scene's contribution to the final render.
type RenderSceneJob struct {
	MediaPath        string  `json:"mediaPath"`
	AudioPath        string  `json:"audioPath"`
	IsImage          bool    `json:"isImage"`
	DurationSec      float64 `json:"durationSec"`
	MediaDurationSec float64 `json:"mediaDurationSec"`
}

// RenderMusicJob is the optional background music track.
type RenderMusicJob struct {
	Path        string  `json:"path"`
	DurationSec float64 `json:"durationSec"`
	Volume      float64 `json:"volume"`
}

// RenderJob renders the final video to OutputPath.
type RenderJob struct {
	ProjectID  string           `json:"projectId"`
	Scenes     []RenderSceneJob `json:"scenes"`
	ASSPath    string           `json:"assPath"`
	Music      *RenderMusicJob  `json:"music,omitempty"`
	OutputPath string           `json:"outputPath"`
}
