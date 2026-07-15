---
target: c3-2004
scope: whole
type: component
parent: c3-20
title: material — stock visual sourcing (Pexels/Pixabay)
---
## Goal

Resolve and download scene visual stock from Pexels or Pixabay to the shared media volume.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | feature |
| Boundary | In-process Go; calls Pexels and Pixabay HTTP APIs; writes to shared media volume |
| Status | active |

## Purpose

Owns MaterialSource interface and provider implementations; NewFromConfig factory; handles both stock download and localAssetPath copy. Non-goal: does not own music sourcing — that is music/.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-seam | ref | NewFromConfig returns MaterialSource interface | high | N.A - no additional notes |
| rule-di-constructor | rule | Compile-time interface checks | high | N.A - no additional notes |
| rule-error-wrap | rule | All errors wrapped | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| MaterialSource.Resolve | OUT | Downloads material to DestPath; returns (source, assetPath) for MaterialResolved event | in-process | worker/internal/material/ |

| MaterialSource.Download | OUT | Downloads asset to DestPath; returns (path, source) | in-process | worker/internal/material/ |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| localAssetPath handling | Contract | N.A - priority: local > stock | worker/internal/jobhandler/material.go |
