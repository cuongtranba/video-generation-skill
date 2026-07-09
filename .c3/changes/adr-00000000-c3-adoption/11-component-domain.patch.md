---
target: c3-101
scope: whole
type: component
parent: c3-1
category: foundation
title: domain — project model & manifest store
---
## Goal

Define the project data model and the persistent, resumable store that every other component reads and writes.

## Parent Fit

| Field | Value |
|---|---|
| Parent | c3-1 vidgen CLI process |
| Layer | Foundation — depended on by cli, flow, cost, worker |
| Depends on | Go stdlib only (`encoding/json`, `os`, `path/filepath`) |
| Consumed by | c3-106 cli, c3-110 flow, c3-104 cost, c3-210 worker |

## Purpose

Owns the concrete project types (`Project`, `Scene`, `Voice`, `Speed`, `CaptionStyle`, `CostLedger` snapshot) and `ManifestStore`, which loads and saves the JSON manifest at `~/.vidgen/projects/<id>/manifest.json`. Non-goals: no pipeline orchestration, no vendor API calls, no cost policy — it is pure state and persistence.

## Governance

| Reference | Type | Governs | Precedence | Notes |
|---|---|---|---|---|
| ref-manifest-state | ref | State is a saved-after-every-step JSON manifest | Authoritative | domain provides the store the ref describes |
| rule-no-any-data | rule | Project/Scene modeled as concrete typed structs | Must | no `map[string]any` state |
| rule-error-wrap | rule | Save/Load errors wrapped with op context | Must | applies to store I/O |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
|---|---|---|---|---|
| `ManifestStore.Save(p)` | OUT | Persists the full project as JSON atomically under its project dir | One manifest per project id | internal/domain/manifest.go |
| `ManifestStore.Load(id)` | IN | Rehydrates a `Project` from disk, error if absent | Read-only | internal/domain/manifest.go |
| `Project.Status` | IN/OUT | Enum drives the status machine; only forward transitions valid | draft→…→published | internal/domain/project.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
|---|---|---|---|
| `manifest.json` on disk | Contract | field additions only via new struct fields | internal/domain/manifest.go |
| domain unit tests | Contract | assertion style | internal/domain/manifest_test.go |
