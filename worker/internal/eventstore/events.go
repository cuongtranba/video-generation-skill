// worker/internal/eventstore/events.go
package eventstore

import (
	"fmt"
	"time"
)

// scenelessMarker is the literal "-" the frozen id scheme
// (index §4: "<type>-<projectId>-<sceneIdx|'-'>") uses for events that are
// not scoped to a single scene.
const scenelessMarker = "-"

// Event is implemented by every concrete event struct this worker publishes.
// Subject and MsgID are derived from the event's own fields so callers never
// hand-build subject strings or dedup keys — this is what makes
// eventstore.PublishResult's msgID handling correct by construction.
type Event interface {
	Subject() string
	MsgID() string
}

func eventSubject(projectID, eventType string) string {
	return fmt.Sprintf("%s.%s.%s", eventSubjectPrefix, projectID, eventType)
}

func sceneMsgID(eventType, projectID string, sceneIdx int) string {
	return fmt.Sprintf("%s-%s-%d", eventType, projectID, sceneIdx)
}

// projectMsgID formats the sceneless-event msgID. The frozen template
// (index §4) is "<type>-<projectId>-<sceneIdx|'-'>"; for the sceneless case
// the trailing "-" IS the third segment, not an extra one appended after an
// already-present separator, so this must not double up on scenelessMarker.
func projectMsgID(eventType, projectID string) string {
	return fmt.Sprintf("%s-%s-", eventType, projectID)
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// MaterialResolved reports that scene SceneIdx's stock/local media has been
// resolved and downloaded to AssetPath. Field names mirror
// spikes/event-model/events.ts exactly (frozen contract, index §4).
type MaterialResolved struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	SceneIdx  int    `json:"sceneIdx"`
	Source    string `json:"source"`
	AssetPath string `json:"assetPath"`
}

func NewMaterialResolved(projectID string, sceneIdx int, source, assetPath string) MaterialResolved {
	return MaterialResolved{
		V: 1, Type: "MaterialResolved", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: sceneIdx, Source: source, AssetPath: assetPath,
	}
}

func (e MaterialResolved) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e MaterialResolved) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// VoiceSynthesized reports that scene SceneIdx's voiceover was synthesized
// to MP3Path, at a metered cost of TTSUsd.
type VoiceSynthesized struct {
	V         int     `json:"v"`
	Type      string  `json:"type"`
	ProjectID string  `json:"projectId"`
	At        string  `json:"at"`
	SceneIdx  int     `json:"sceneIdx"`
	MP3Path   string  `json:"mp3Path"`
	TTSUsd    float64 `json:"ttsUsd"`
}

func NewVoiceSynthesized(projectID string, sceneIdx int, mp3Path string, ttsUsd float64) VoiceSynthesized {
	return VoiceSynthesized{
		V: 1, Type: "VoiceSynthesized", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: sceneIdx, MP3Path: mp3Path, TTSUsd: ttsUsd,
	}
}

func (e VoiceSynthesized) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e VoiceSynthesized) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// CaptionsBuilt reports that the project's ASS caption file was written to
// ASSPath. SceneIdx is always 0 — see plan decision #6: the kept caption
// pipeline produces one ASS file per project, not per scene.
type CaptionsBuilt struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	SceneIdx  int    `json:"sceneIdx"`
	ASSPath   string `json:"assPath"`
}

func NewCaptionsBuilt(projectID, assPath string) CaptionsBuilt {
	return CaptionsBuilt{
		V: 1, Type: "CaptionsBuilt", ProjectID: projectID, At: nowRFC3339(),
		SceneIdx: 0, ASSPath: assPath,
	}
}

func (e CaptionsBuilt) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e CaptionsBuilt) MsgID() string   { return sceneMsgID(e.Type, e.ProjectID, e.SceneIdx) }

// RenderCompleted reports that the final video was rendered to OutputPath
// at a metered cost of RenderUsd. Project-scoped: there is exactly one
// render per project.
type RenderCompleted struct {
	V          int     `json:"v"`
	Type       string  `json:"type"`
	ProjectID  string  `json:"projectId"`
	At         string  `json:"at"`
	OutputPath string  `json:"outputPath"`
	RenderUsd  float64 `json:"renderUsd"`
}

func NewRenderCompleted(projectID, outputPath string, renderUsd float64) RenderCompleted {
	return RenderCompleted{
		V: 1, Type: "RenderCompleted", ProjectID: projectID, At: nowRFC3339(),
		OutputPath: outputPath, RenderUsd: renderUsd,
	}
}

func (e RenderCompleted) Subject() string { return eventSubject(e.ProjectID, e.Type) }
func (e RenderCompleted) MsgID() string   { return projectMsgID(e.Type, e.ProjectID) }

// RunFailed reports that pipeline Stage failed for ProjectID with Error.
// SceneIdx (-1 for stages that aren't per-scene: caption, render) is used
// ONLY to compute MsgID — see plan decision #5. It is deliberately excluded
// from JSON (json:"-") because the frozen schema
// (spikes/event-model/events.ts) has no sceneIdx field on RunFailed.
type RunFailed struct {
	V         int    `json:"v"`
	Type      string `json:"type"`
	ProjectID string `json:"projectId"`
	At        string `json:"at"`
	Stage     string `json:"stage"`
	Error     string `json:"error"`
	SceneIdx  int    `json:"-"`
}

func NewRunFailed(projectID, stage string, sceneIdx int, cause error) RunFailed {
	return RunFailed{
		V: 1, Type: "RunFailed", ProjectID: projectID, At: nowRFC3339(),
		Stage: stage, Error: cause.Error(), SceneIdx: sceneIdx,
	}
}

func (e RunFailed) Subject() string { return eventSubject(e.ProjectID, e.Type) }

// MsgID extends the frozen 3-part template with Stage — see plan decision
// #5: without it, two different stages failing for the same project (or
// same scene) within the dedup window would silently collapse into one
// stored event.
func (e RunFailed) MsgID() string {
	if e.SceneIdx < 0 {
		return fmt.Sprintf("%s-%s-%s-", e.Type, e.ProjectID, e.Stage)
	}
	return fmt.Sprintf("%s-%s-%s-%d", e.Type, e.ProjectID, e.Stage, e.SceneIdx)
}
