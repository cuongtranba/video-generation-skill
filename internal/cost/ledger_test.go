package cost

import (
	"errors"
	"testing"

	"github.com/cuongtranba/video-generation-skill/internal/domain"
)

func TestLedgerTotalsAndSnapshot(t *testing.T) {
	l := NewLedger()
	l.AddProjected(domain.CostLineItem{Label: "tts", Unit: domain.UnitChars, Quantity: 1000, USDCost: 0.01})
	l.AddProjected(domain.CostLineItem{Label: "api", Unit: domain.UnitAPICalls, Quantity: 3, USDCost: 0.005})
	l.AddActual(domain.CostLineItem{Label: "tts", Unit: domain.UnitChars, Quantity: 980, USDCost: 0.0098})

	if got := l.ProjectedTotal(); got != 0.015 {
		t.Errorf("ProjectedTotal = %v, want 0.015", got)
	}
	if got := l.ActualTotal(); got != 0.0098 {
		t.Errorf("ActualTotal = %v, want 0.0098", got)
	}

	snap := l.Snapshot()
	if snap.CapUSD != CapUSD {
		t.Errorf("Snapshot CapUSD = %v, want %v", snap.CapUSD, CapUSD)
	}
	if len(snap.Projected) != 2 || len(snap.Actual) != 1 {
		t.Errorf("Snapshot lens = %d/%d, want 2/1", len(snap.Projected), len(snap.Actual))
	}

	// snapshot must be a copy, not a live reference
	snap.Projected[0].USDCost = 99
	if l.ProjectedTotal() != 0.015 {
		t.Error("mutating snapshot changed ledger")
	}
}

func TestLedgerFromExisting(t *testing.T) {
	existing := domain.CostLedger{
		CapUSD:    CapUSD,
		Projected: []domain.CostLineItem{{Label: "a", USDCost: 0.02}},
		Actual:    []domain.CostLineItem{{Label: "a", USDCost: 0.019}},
	}
	l := FromLedger(existing)
	if l.ProjectedTotal() != 0.02 || l.ActualTotal() != 0.019 {
		t.Errorf("FromLedger totals = %v/%v", l.ProjectedTotal(), l.ActualTotal())
	}
}

func TestCheckProjected(t *testing.T) {
	tests := []struct {
		name    string
		total   float64
		wantErr bool
	}{
		{"well under cap", 0.05, false},
		{"exactly at cap", 0.10, false},
		{"over cap", 0.100001, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := NewLedger()
			l.AddProjected(domain.CostLineItem{Label: "x", USDCost: tt.total})
			err := l.CheckProjected()
			if (err != nil) != tt.wantErr {
				t.Errorf("CheckProjected() = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && !errors.Is(err, ErrCostCapExceeded) {
				t.Errorf("error should wrap ErrCostCapExceeded: %v", err)
			}
		})
	}
}

func TestCheckActual(t *testing.T) {
	l := NewLedger()
	l.AddActual(domain.CostLineItem{Label: "x", USDCost: 0.11})
	if err := l.CheckActual(); !errors.Is(err, ErrCostCapExceeded) {
		t.Errorf("CheckActual should exceed cap: %v", err)
	}
}

func TestEstimateTTS(t *testing.T) {
	e := NewEstimator()
	item := e.EstimateTTS(1200)
	if item.Quantity != 1200 {
		t.Errorf("Quantity = %d, want 1200", item.Quantity)
	}
	if item.Unit != domain.UnitChars {
		t.Errorf("Unit = %q, want chars", item.Unit)
	}
	want := 1200 * FPTAIPerChar
	if item.USDCost != want {
		t.Errorf("USDCost = %v, want %v", item.USDCost, want)
	}
}

func TestEstimateProject(t *testing.T) {
	e := NewEstimator()
	scenes := []domain.Scene{
		{Narration: "Xin chào các bạn"},
		{Narration: "Hẹn gặp lại"},
	}
	items := e.EstimateProject(scenes)
	if len(items) == 0 {
		t.Fatal("EstimateProject returned no items")
	}
	var totalChars int64
	for _, it := range items {
		if it.Unit == domain.UnitChars {
			totalChars += it.Quantity
		}
	}
	wantChars := int64(len([]rune("Xin chào các bạn")) + len([]rune("Hẹn gặp lại")))
	if totalChars != wantChars {
		t.Errorf("total chars = %d, want %d", totalChars, wantChars)
	}
}
