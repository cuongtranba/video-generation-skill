---
target: rule-error-wrap
scope: whole
type: rule
title: Wrap every error with operation context
---
## Goal

Every error crossing a function boundary must carry an operation-tagged context chain, so a failure deep in the pipeline is traceable to the exact step that produced it across all packages.

## Rule

Wrap every returned error with `fmt.Errorf("<op>: %w", err)`; never `return err` bare.

## Golden Example

Literal from `internal/cli/root.go` — the operation name prefixes the wrapped cause, `%w` preserves the chain.

```go
providers, err := config.LoadProviders(cfgPath)   // REQUIRED: capture err
if err != nil {
	return fmt.Errorf("load providers config: %w", err)   // REQUIRED: op prefix + %w verb
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
|---|---|---|
| `return err` | `return fmt.Errorf("load providers config: %w", err)` | Loses the operation context; failures become untraceable across the long pipeline |
| `fmt.Errorf("load providers config: %v", err)` | `...: %w`, err | `%v` breaks the error chain — `errors.Is`/`errors.As` (e.g. `ErrCostCapExceeded`) can no longer match |

## Scope

Applies to every `error` returned from a function. Does not apply to errors that are handled (logged/recovered) locally and not returned.
