---
target: rule-no-any-data
scope: whole
type: rule
title: Concrete types for data — no any/interface{}
---
## Goal

All domain and message data must be modeled with concrete named types across every package; `any`/`interface{}`/untyped maps are banned as data carriers, permitted only as a generic type constraint.

## Rule

Data structures use concrete named types; never `any`, `interface{}`, or untyped maps for domain or message data.

## Golden Example

Literal from `internal/worker/types.go` — a bus message modeled as a concrete struct with typed fields, not a `map[string]any`.

```go
type TTSJob struct {                       // REQUIRED: named struct, not map[string]any
	ProjectID  string       `json:"project_id"`
	SceneIndex int          `json:"scene_index"`
	Text       string       `json:"text"`
	Voice      domain.Voice `json:"voice"`  // REQUIRED: domain type, not string/any
	Speed      domain.Speed `json:"speed"`
	DestPath   string       `json:"dest_path"`
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
|---|---|---|
| `job map[string]any` marshalled to the bus | `type TTSJob struct{...}` | Loses type safety across the JetStream boundary; field typos surface only at runtime |
| `Voice any` | `Voice domain.Voice` | A stringly/any-typed enum bypasses the voice/speed validation the domain types enforce |

## Scope

Applies to domain models, bus job/result messages, and config structs. `any` is permitted solely as a generic type constraint (e.g. `[T any]`).
