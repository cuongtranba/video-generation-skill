---
id: rule-cost-wall
c3-seal: 6c9c58e3cee93fa21e08e964f7c002eb2c0d12cfc6326fdaf819f9edb1e61b01
title: Inviolable per-video cost cap
type: rule
goal: A hard USD cap per video must be enforced at both projection and execution time and must never be removed or weakened, so a runaway or misconfigured run can never spend beyond the budget.
---

## Goal

A hard USD cap per video must be enforced at both projection and execution time and must never be removed or weakened, so a runaway or misconfigured run can never spend beyond the budget.

## Rule

Cost is checked against `CapUSD` (0.10) both projected (at confirm) and actual (during generate); the checks are never removed or loosened.

## Golden Example

Literal from `internal/cost/ledger.go` — the cap is a constant, the check returns a sentinel-wrapped error when exceeded, and `Confirm`/`generate` call it.

```go
const CapUSD = 0.10                               // REQUIRED: single source of the cap
var ErrCostCapExceeded = errors.New("cost cap exceeded")

func (l *Ledger) CheckProjected() error {         // REQUIRED: guard called before spend
	if total := l.ProjectedTotal(); total > CapUSD {
		return fmt.Errorf("projected cost $%.4f exceeds cap $%.2f: %w", total, CapUSD, ErrCostCapExceeded)
	}
	return nil
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Raising CapUSD to silence a failing confirm | keep the cap; reduce scenes/chars | The cap is the safety contract; loosening it defeats its purpose |
| Skipping CheckProjected/CheckActual on a "trusted" path | always gate spend behind the check | A single unchecked path is a budget hole; both projection and actual must gate |

## Override

None. This rule has no sanctioned deviation — the cap and both checks are load-bearing safety.
