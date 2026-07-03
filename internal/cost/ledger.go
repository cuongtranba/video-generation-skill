package cost

import (
	"errors"
	"fmt"
	"sync"

	"github.com/cuongtranba/video-generation-skill/internal/domain"
)

// CapUSD is the hard cost cap per video (anti-goal tripwire).
const CapUSD = 0.10

var ErrCostCapExceeded = errors.New("cost cap exceeded")

type Ledger struct {
	mu        sync.Mutex
	projected []domain.CostLineItem
	actual    []domain.CostLineItem
}

func NewLedger() *Ledger {
	return &Ledger{}
}

func FromLedger(l domain.CostLedger) *Ledger {
	return &Ledger{
		projected: append([]domain.CostLineItem(nil), l.Projected...),
		actual:    append([]domain.CostLineItem(nil), l.Actual...),
	}
}

func (l *Ledger) AddProjected(item domain.CostLineItem) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.projected = append(l.projected, item)
}

func (l *Ledger) AddActual(item domain.CostLineItem) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.actual = append(l.actual, item)
}

func (l *Ledger) ProjectedTotal() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return sumItems(l.projected)
}

func (l *Ledger) ActualTotal() float64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	return sumItems(l.actual)
}

// Snapshot returns a deep copy suitable for manifest serialization.
func (l *Ledger) Snapshot() domain.CostLedger {
	l.mu.Lock()
	defer l.mu.Unlock()
	return domain.CostLedger{
		CapUSD:    CapUSD,
		Projected: append([]domain.CostLineItem(nil), l.projected...),
		Actual:    append([]domain.CostLineItem(nil), l.actual...),
	}
}

// CheckProjected enforces the admissibility gate before generation starts.
func (l *Ledger) CheckProjected() error {
	if total := l.ProjectedTotal(); total > CapUSD {
		return fmt.Errorf("projected cost $%.4f exceeds cap $%.2f: %w", total, CapUSD, ErrCostCapExceeded)
	}
	return nil
}

// CheckActual enforces the wall during generation, after each recorded cost.
func (l *Ledger) CheckActual() error {
	if total := l.ActualTotal(); total > CapUSD {
		return fmt.Errorf("actual cost $%.4f exceeds cap $%.2f: %w", total, CapUSD, ErrCostCapExceeded)
	}
	return nil
}

func sumItems(items []domain.CostLineItem) float64 {
	var total float64
	for _, it := range items {
		total += it.USDCost
	}
	return total
}
