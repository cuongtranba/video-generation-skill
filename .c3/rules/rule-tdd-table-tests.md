---
id: rule-tdd-table-tests
c3-seal: 146f4373e0487733eff4ed882a42d2226c1cf5df63e93d181f6fe0e0f2ae9b6f
title: Table-driven tests with faked externals
type: rule
goal: Behavior across every package must be verified by table-driven tests, with external HTTP APIs and subprocess tools faked, so the suite is deterministic, offline, and cheap to extend with new cases.
---

## Goal

Behavior across every package must be verified by table-driven tests, with external HTTP APIs and subprocess tools faked, so the suite is deterministic, offline, and cheap to extend with new cases.

## Rule

Tests are table-driven (`tests := []struct{...}{...}` ranged over subtests); HTTP APIs are mocked with `httptest` and subprocess tools are faked with shell scripts in temp dirs.

## Golden Example

Literal from `internal/cost/ledger_test.go` — cases declared as a slice of anonymous structs, then ranged.

```go
tests := []struct {                 // REQUIRED: slice-of-struct case table
	name    string
	total   float64
	wantErr bool
}{
	{"well under cap", 0.05, false},
	{"exactly at cap", 0.10, false},
	{"over cap", 0.100001, true},
}
for _, tt := range tests {          // REQUIRED: range over cases (t.Run subtests)
	// ...
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| A separate TestX_caseA/TestX_caseB per case | one table ranged over subtests | Duplicated setup drifts; the table keeps cases uniform |
| Hitting the real ElevenLabs / Pexels endpoint in a test | httptest.NewServer stub | Non-deterministic, costs money, breaks offline CI |
