---
id: rule-di-constructor
c3-seal: bfa3c5e7401bdf7fcd99dcc095bc6d84574975f65cc5d123ec910cc450f5159e
title: Constructor injection with compile-time interface checks
type: rule
goal: Dependencies must be injected through constructors with no package-level mutable state, and every implementation must prove it satisfies its interface at compile time, so wiring stays explicit and testable across all packages.
---

## Goal

Dependencies must be injected through constructors with no package-level mutable state, and every implementation must prove it satisfies its interface at compile time, so wiring stays explicit and testable across all packages.

## Rule

Types receive collaborators via a `New*` constructor, and each implementation declares `var _ Interface = (*T)(nil)`.

## Golden Example

Literal from `internal/render/renderer.go` and `internal/flow/flow.go` — compile-time conformance assertion plus constructor injection of a dependency struct.

```go
var _ Renderer = (*FFmpegRenderer)(nil)   // REQUIRED: compile-time interface check

func New(deps Deps) *Flow {               // REQUIRED: deps injected via constructor
	return &Flow{
		store:  deps.Store,
		script: deps.Script,
		// ...
	}
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Package-level var store *ManifestStore mutated at runtime | field on a struct built by New(deps Deps) | Global mutable state defeats parallel per-scene workers and makes tests non-deterministic |
| No var _ I = (*T)(nil) | declare the assertion next to the type | A drifted method set fails silently at the call site instead of at compile time |
