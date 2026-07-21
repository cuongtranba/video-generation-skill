package domain

import (
	"path/filepath"
	"testing"
	"time"
)

func testProject() *Project {
	return &Project{
		ID:        "test-id-123",
		CreatedAt: time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC),
		UpdatedAt: time.Date(2026, 7, 3, 11, 0, 0, 0, time.UTC),
		Status:    StatusDraft,
		Idea:      "3 lý do bạn nên uống nước ấm mỗi sáng",
		ResourceDir: "./demo",
		Scenes: []Scene{
			{
				Index:      0,
				Narration:  "Mỗi buổi sáng, một ly nước ấm giúp cơ thể tỉnh táo.",
				VisualNote: "morning sunrise warm drink",
				Material: MaterialRef{
					Type:        MaterialVideo,
					SourceID:    "pexels-123",
					LocalPath:   "/tmp/clip.mp4",
					DurationSec: 5.2,
				},
				AudioPath:   "/tmp/scene0.mp3",
				DurationSec: 4.8,
			},
		},
		Style: StyleSettings{
			Voice:       VoiceBanmai,
			Speed:       1,
			DurationSec: 45,
			Tone:        "casual",
			CaptionStyle: CaptionStyle{
				FontName: "Arial",
				FontSize: 36,
				Primary:  "#FFFFFF",
				Outline:  "#000000",
				Bold:     true,
			},
		},
		CostLedger: CostLedger{
			CapUSD: 0.10,
			Projected: []CostLineItem{
				{Label: "ElevenLabs TTS", Unit: UnitChars, Quantity: 1200, USDCost: 0.012},
			},
			Actual: []CostLineItem{
				{Label: "ElevenLabs TTS", Unit: UnitChars, Quantity: 1180, USDCost: 0.0118},
			},
		},
	}
}

func TestManifestStoreRoundTrip(t *testing.T) {
	store := NewManifestStore(t.TempDir())
	want := testProject()

	if err := store.Save(want); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := store.Load(want.ID)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if got.ID != want.ID {
		t.Errorf("ID = %q, want %q", got.ID, want.ID)
	}
	if got.Idea != want.Idea {
		t.Errorf("Idea = %q, want %q", got.Idea, want.Idea)
	}
	if got.Status != want.Status {
		t.Errorf("Status = %q, want %q", got.Status, want.Status)
	}
	if got.ResourceDir != want.ResourceDir {
		t.Errorf("ResourceDir = %q, want %q", got.ResourceDir, want.ResourceDir)
	}
	if len(got.Scenes) != 1 {
		t.Fatalf("Scenes len = %d, want 1", len(got.Scenes))
	}
	if got.Scenes[0].Narration != want.Scenes[0].Narration {
		t.Errorf("Narration = %q, want %q", got.Scenes[0].Narration, want.Scenes[0].Narration)
	}
	if got.Scenes[0].Material != want.Scenes[0].Material {
		t.Errorf("Material = %+v, want %+v", got.Scenes[0].Material, want.Scenes[0].Material)
	}
	if got.Style != want.Style {
		t.Errorf("Style = %+v, want %+v", got.Style, want.Style)
	}
	if got.CostLedger.CapUSD != 0.10 {
		t.Errorf("CapUSD = %v, want 0.10", got.CostLedger.CapUSD)
	}
	if len(got.CostLedger.Projected) != 1 || len(got.CostLedger.Actual) != 1 {
		t.Errorf("ledger lens = %d/%d, want 1/1", len(got.CostLedger.Projected), len(got.CostLedger.Actual))
	}
	if !got.CreatedAt.Equal(want.CreatedAt) {
		t.Errorf("CreatedAt = %v, want %v", got.CreatedAt, want.CreatedAt)
	}
}

func TestManifestStoreLoadMissing(t *testing.T) {
	store := NewManifestStore(t.TempDir())
	if _, err := store.Load("nope"); err == nil {
		t.Fatal("Load missing project: want error, got nil")
	}
}

func TestManifestStoreList(t *testing.T) {
	store := NewManifestStore(t.TempDir())

	p1 := testProject()
	p2 := testProject()
	p2.ID = "test-id-456"
	p2.Status = StatusRendered

	for _, p := range []*Project{p1, p2} {
		if err := store.Save(p); err != nil {
			t.Fatalf("Save %s: %v", p.ID, err)
		}
	}

	list, err := store.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List len = %d, want 2", len(list))
	}
}

func TestManifestStoreListEmpty(t *testing.T) {
	store := NewManifestStore(filepath.Join(t.TempDir(), "does-not-exist-yet"))
	list, err := store.List()
	if err != nil {
		t.Fatalf("List on empty base dir: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("List len = %d, want 0", len(list))
	}
}

func TestProjectDir(t *testing.T) {
	base := t.TempDir()
	store := NewManifestStore(base)
	got := store.ProjectDir("abc")
	want := filepath.Join(base, "abc")
	if got != want {
		t.Errorf("ProjectDir = %q, want %q", got, want)
	}
}

func TestCostLedgerTotals(t *testing.T) {
	tests := []struct {
		name          string
		ledger        CostLedger
		wantProjected float64
		wantActual    float64
	}{
		{
			name:   "empty ledger",
			ledger: CostLedger{CapUSD: 0.10},
		},
		{
			name: "sums line items",
			ledger: CostLedger{
				CapUSD: 0.10,
				Projected: []CostLineItem{
					{Label: "a", USDCost: 0.01},
					{Label: "b", USDCost: 0.02},
				},
				Actual: []CostLineItem{
					{Label: "a", USDCost: 0.015},
				},
			},
			wantProjected: 0.03,
			wantActual:    0.015,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ledger.ProjectedTotal(); got != tt.wantProjected {
				t.Errorf("ProjectedTotal = %v, want %v", got, tt.wantProjected)
			}
			if got := tt.ledger.ActualTotal(); got != tt.wantActual {
				t.Errorf("ActualTotal = %v, want %v", got, tt.wantActual)
			}
		})
	}
}

func TestStatusAdvance(t *testing.T) {
	tests := []struct {
		from Status
		want Status
	}{
		{StatusDraft, StatusMaterial},
		{StatusMaterial, StatusTuned},
		{StatusTuned, StatusConfirmed},
		{StatusConfirmed, StatusRendered},
		{StatusRendered, StatusPublished},
	}
	for _, tt := range tests {
		t.Run(string(tt.from), func(t *testing.T) {
			if got := tt.from.Next(); got != tt.want {
				t.Errorf("%s.Next() = %s, want %s", tt.from, got, tt.want)
			}
		})
	}
}

func TestStatusNextPublished(t *testing.T) {
	if got := StatusRendered.Next(); got != StatusPublished {
		t.Errorf("StatusRendered.Next() = %q, want %q", got, StatusPublished)
	}
	if got := StatusPublished.Next(); got != StatusPublished {
		t.Errorf("StatusPublished.Next() = %q, want %q (terminal)", got, StatusPublished)
	}
}

func TestVoiceValid(t *testing.T) {
	for _, v := range AllVoices() {
		if !v.Valid() {
			t.Errorf("voice %q should be valid", v)
		}
	}
	if Voice("robotvoice").Valid() {
		t.Error("unknown voice should be invalid")
	}
}

func TestSpeedValid(t *testing.T) {
	tests := []struct {
		speed Speed
		want  bool
	}{
		{-4, false}, {-3, true}, {0, true}, {3, true}, {4, false},
	}
	for _, tt := range tests {
		if got := tt.speed.Valid(); got != tt.want {
			t.Errorf("Speed(%d).Valid() = %v, want %v", tt.speed, got, tt.want)
		}
	}
}
