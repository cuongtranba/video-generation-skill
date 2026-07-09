---
target: ref-manifest-state
scope: whole
type: ref
title: Resumable project state as a saved-after-every-step JSON manifest
---
## Goal

Project state must survive process exit and let every pipeline step resume from where the last run stopped, without redoing prior steps. Standardizes where the single source of project truth lives and when it is persisted.

## Choice

The one source of project truth is a JSON manifest at `~/.vidgen/projects/<id>/manifest.json`, co-located with all its assets, loaded and saved through `domain.ManifestStore` after every step. A `Status` field drives a linear status machine (`draft → material → tuned → confirmed → rendered → published`) that gates which step may run next.

## Why

The pipeline is long, multi-vendor, and failure-prone; holding state only in memory would lose all prior work on any crash and make partial re-runs impossible. Persisting a JSON manifest after every step — beside the assets it references — makes each step independently resumable, the whole flow inspectable offline, and status transitions the single guard on step ordering. A database was rejected as overkill for a single-user CLI whose assets are already on the local filesystem.

## How

Golden pattern — mutate the in-memory project, advance `Status`, then persist through the store before returning (REQUIRED: status advance + `store.Save(p)` on every successful step). Source: `internal/flow/flow.go`, `internal/domain/manifest.go`.

```go
p.CostLedger = ledger.Snapshot()
p.Status = domain.StatusConfirmed
p.UpdatedAt = f.now()
if err := f.store.Save(p); err != nil {
	return ledger, fmt.Errorf("save project: %w", err)
}
```
