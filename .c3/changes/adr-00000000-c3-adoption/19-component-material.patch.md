---
target: c3-112
scope: whole
type: component
parent: c3-1
category: feature
title: material — stock & local visual sourcing
---
## Goal

Supply each scene with a visual (stock clip/image or local asset) that covers its narration duration.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Feature — pipeline step feeding the renderer |
| Depends on | c3-102 config (provider list + keys), Pexels/Pixabay HTTP APIs, local filesystem |
| Consumed by | c3-110 flow (material step), c3-210 worker (MaterialJob) |

## Purpose

Owns `MaterialSource` and its implementations — `PexelsSource`, `PixabaySource`, a `Chain` tried in configured order, and `LocalSource` for `asset:`-prefixed local files — plus `NewFromConfig`. Non-goals: no music (that is a separate category), no rendering.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| ref-provider-seam | ref | `NewFromConfig` builds a `Chain` from the ordered provider names | Authoritative | keys from config, not YAML |
| rule-di-constructor | rule | `var _ MaterialSource = (*PexelsSource)(nil)`; injected keys | Must | compile-time seam check |
| rule-error-wrap | rule | HTTP/source errors wrapped with op context | Must | per-provider wrap |
| rule-tdd-table-tests | rule | Sources tested against `httptest` stubs | Must | no live API in tests |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `MaterialSource.Search(ctx, query)` | IN/OUT | Returns a clip/image URL for the query; Chain falls through on miss | Free-tier stock APIs | internal/material/source.go |
| `NewFromConfig(sel, keys)` | IN | Builds an ordered `Chain`; errors on empty/unknown provider | pexels, pixabay | internal/material/factory.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| stock source tests | Contract | httptest-stubbed responses | internal/material/pexels_test.go |
