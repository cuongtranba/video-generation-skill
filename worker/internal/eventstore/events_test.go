// worker/internal/eventstore/events_test.go
package eventstore

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, ev Event) string {
	t.Helper()
	data, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("marshal %T: %v", ev, err)
	}
	return string(data)
}

func TestMaterialResolved(t *testing.T) {
	ev := NewMaterialResolved("proj1", 2, "pexels", "/data/media/proj1/scene-2.mp4")

	if got, want := ev.Subject(), "vidgen.evt.proj1.MaterialResolved"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "MaterialResolved-proj1-2"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"MaterialResolved"`, `"projectId":"proj1"`,
		`"sceneIdx":2`, `"source":"pexels"`, `"assetPath":"/data/media/proj1/scene-2.mp4"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestVoiceSynthesized(t *testing.T) {
	ev := NewVoiceSynthesized("proj1", 1, "/data/media/proj1/scene-1.mp3", 3.5, 0.00042)

	if got, want := ev.Subject(), "vidgen.evt.proj1.VoiceSynthesized"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "VoiceSynthesized-proj1-1"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"VoiceSynthesized"`, `"projectId":"proj1"`,
		`"sceneIdx":1`, `"mp3Path":"/data/media/proj1/scene-1.mp3"`, `"durationSec":3.5`, `"ttsUsd":0.00042`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestCaptionsBuilt(t *testing.T) {
	ev := NewCaptionsBuilt("proj1", "/data/media/proj1/captions.ass")

	if got, want := ev.Subject(), "vidgen.evt.proj1.CaptionsBuilt"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "CaptionsBuilt-proj1-0"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"CaptionsBuilt"`, `"projectId":"proj1"`,
		`"sceneIdx":0`, `"assPath":"/data/media/proj1/captions.ass"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestRenderCompleted(t *testing.T) {
	ev := NewRenderCompleted("proj1", "/data/media/proj1/out.mp4", 0.0)

	if got, want := ev.Subject(), "vidgen.evt.proj1.RenderCompleted"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := ev.MsgID(), "RenderCompleted-proj1-"; got != want {
		t.Errorf("MsgID() = %q, want %q", got, want)
	}

	data := mustJSON(t, ev)
	for _, want := range []string{
		`"v":1`, `"type":"RenderCompleted"`, `"projectId":"proj1"`,
		`"outputPath":"/data/media/proj1/out.mp4"`, `"renderUsd":0`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
}

func TestRunFailed(t *testing.T) {
	sceneFail := NewRunFailed("proj1", "material", 2, errors.New("no material found"))
	projectFail := NewRunFailed("proj1", "render", -1, errors.New("ffmpeg exit 1"))

	if got, want := sceneFail.Subject(), "vidgen.evt.proj1.RunFailed"; got != want {
		t.Errorf("Subject() = %q, want %q", got, want)
	}
	if got, want := sceneFail.MsgID(), "RunFailed-proj1-material-2"; got != want {
		t.Errorf("scene-scoped MsgID() = %q, want %q", got, want)
	}
	if got, want := projectFail.MsgID(), "RunFailed-proj1-render-"; got != want {
		t.Errorf("project-scoped MsgID() = %q, want %q", got, want)
	}

	// two different stages failing for the same project must NOT collide
	otherStageFail := NewRunFailed("proj1", "tts", -1, errors.New("FPT timeout"))
	if projectFail.MsgID() == otherStageFail.MsgID() {
		t.Fatalf("distinct stages produced the same MsgID %q — would dedup-collide", projectFail.MsgID())
	}

	data := mustJSON(t, sceneFail)
	for _, want := range []string{
		`"v":1`, `"type":"RunFailed"`, `"projectId":"proj1"`,
		`"stage":"material"`, `"error":"no material found"`,
	} {
		if !strings.Contains(data, want) {
			t.Errorf("JSON %s missing %s", data, want)
		}
	}
	if strings.Contains(data, `sceneIdx`) {
		t.Errorf("JSON %s must not contain sceneIdx (not part of the frozen RunFailed schema): %s", data, data)
	}
}
