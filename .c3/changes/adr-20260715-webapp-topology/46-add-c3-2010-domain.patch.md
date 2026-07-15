---
target: c3-2010
scope: whole
type: component
parent: c3-20
title: domain — shared domain types (Voice, Speed, CaptionStyle)
---
## Goal

Define the domain value types shared across job handler, TTS, and config packages.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-20 worker |
| Category | foundation |
| Boundary | In-process Go; imported by jobhandler, tts, config |
| Status | active |

## Purpose

Owns Voice (string enum: banmai, thuminh, lannhi, linhsan, leminh, giahuy, myan), Speed (int -3..3), and CaptionStyle (font_name, font_size, primary, outline, bold — note: snake_case JSON tags, a documented inconsistency with the rest of the webapp's camelCase convention). Non-goal: does not own business logic.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Voice and Speed are distinct named types, not string/int aliases | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Voice | OUT | Named type wrapping string; valid values: banmai, thuminh, lannhi, linhsan, leminh, giahuy, myan | in-process | worker/internal/domain/ |
| CaptionStyle | OUT | snake_case JSON tags (font_name, font_size) — documented inconsistency with webapp camelCase | NATS job payload | worker/internal/jobhandler/types.go |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| VALID_VOICES in api/src/commands.ts | Contract | N.A - exact match | api/src/commands.ts line 56 |
