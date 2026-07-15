---
id: adr-20260715-webapp-topology
c3-seal: 9bf245ed9ce70f5648c62bf245a0288072aac074631b1c67a02470eaf2e25b5f
title: webapp-topology
type: adr
goal: 'Replace the deleted monolithic Go CLI topology (c3-1 "vidgen CLI process", c3-2 "Message bus / async execution plane", and their 14 sub-components) with a three-container webapp topology: `api` (TypeScript/Bun, event-sourced command surface + Postgres projections), `worker` (Go, idempotent job consumers), and `frontend` (Vite/React/Zustand, live event board + TunePanel). Retire ref-manifest-state (project state now lives in NATS JetStream + Postgres, not a JSON manifest). Record the two authorized contract changes: (1) StyleSet event + TuneProject command; (2) VoiceSynthesized gains durationSec enabling per-scene audioDurationSec fold and ApproveStoryboard readiness gate.'
status: accepted
date: "2026-07-15"
---

## Goal

Replace the deleted monolithic Go CLI topology (c3-1 "vidgen CLI process", c3-2 "Message bus / async execution plane", and their 14 sub-components) with a three-container webapp topology: `api` (TypeScript/Bun, event-sourced command surface + Postgres projections), `worker` (Go, idempotent job consumers), and `frontend` (Vite/React/Zustand, live event board + TunePanel). Retire ref-manifest-state (project state now lives in NATS JetStream + Postgres, not a JSON manifest). Record the two authorized contract changes: (1) StyleSet event + TuneProject command; (2) VoiceSynthesized gains durationSec enabling per-scene audioDurationSec fold and ApproveStoryboard readiness gate.

## Context

The root `cmd/`, `internal/`, `go.mod`, and `go.sum` of the Go CLI were deleted in the webapp pivot. All 25 C3 entities now point at non-existent code paths. The project is now a webapp with four runtime processes (NATS JetStream, Postgres, api, worker) plus a frontend SPA. The frozen event catalogue (`VidgenEvent` union in `api/src/events.ts`) mirrors the worker's Go event structs in `worker/internal/eventstore/events.go` — this cross-language mirror is the core architectural contract. The old `ref-manifest-state` described a local JSON manifest at `~/.vidgen/projects/<id>/manifest.json`; project state now comes from replaying NATS JetStream events via `foldProject` and a Postgres projection maintained by the projections consumer in `api/src/projections.ts`.

## Decision

Retire c3-1, c3-2, and all 14 child components (c3-101 through c3-115, c3-201, c3-210) plus ref-manifest-state in one atomic change-unit. Add three new containers: `api` (c3-10), `worker` (c3-20), `frontend` (c3-30). Under each container, add the components that own the real code. Update c3-0's Goal and Abstract Constraints to reflect the webapp model. Update ref-idempotent-worker and ref-provider-seam with real code paths from the webapp. Keep rule-cost-wall, rule-di-constructor, rule-error-wrap, rule-no-any-data, rule-tdd-table-tests — all still apply. Add ref-event-contract as a new standalone ref for the frozen cross-language event catalogue.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Goal and Abstract Constraints describe CLI pipeline; must be updated to webapp model | c3-0#n495@v2:sha256:28ceb5b0a9d0d851762f54fe43bfe05c9f3614812f33414bbb1a02be735b8ff6 | Update Goal + Abstract Constraints |
| c3-1 | container | Deleted — the Go CLI process no longer exists; code at internal/ was removed | c3-1#n510@v2:sha256:f7e9a764be1726c70f8c102f5126e3244664a0143cac8c08e651f56975b9752d | Retire — no successor for the CLI process |
| c3-2 | container | Deleted — NATS is now an external process, not embedded; the old bus container no longer exists | c3-2#n529@v2:sha256:65c1323806b606a8abcf119634fb2c766e5c867e3a08d7bb659af22b92234ba1 | Retire — NATS JetStream modeled as infrastructure, workers move to c3-20 |
| ref-manifest-state | ref | JSON manifest state pattern replaced by event sourcing and Postgres projection; no manifest.json exists | ref-manifest-state#n33@v1:sha256:21a3b8b5b025822ce0f8e03620a24e5cc7558aad41681a4d5aebfba08d488a36 | Retire — succeeded by event sourcing + Postgres projection |
| ref-idempotent-worker | ref | Pattern still holds; code path now at worker/internal/jobhandler/ instead of deleted internal/worker/ | ref-idempotent-worker#n24@v1:sha256:1d802d2e18bd54b6fc9dc4b0572e2ce10793149efe6306924b63200251372e32 | Update How section with real paths |
| ref-provider-seam | ref | Pattern still holds; factory now at worker/internal/tts/factory.go; update How with real paths | ref-provider-seam#n15@v1:sha256:cf44bdfa3d9f0204083c37f7955db1ff5582035c20f8a374487de348cd6c2515 | Update How section with real paths |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-cost-wall | api/src/cost.ts enforces per-video cost cap; cap and both checks must never be removed | rule-cost-wall#n82@v1:sha256:bddd6c55eb48a138d70b3f35fd8b3747a35aa4e9689abf0ad089d552d1ff0f75 | comply — cap now $0.15 via COST_CAP_USD env, enforced in commands.ts + cost.ts |
| rule-di-constructor | Go worker uses New* constructors and var _ I = (*T)(nil) compile-time checks throughout | rule-di-constructor#n56@v1:sha256:7769dbc022335a59b7ab88e5b352b2be375d5b4f990ccaa7d70862cdf760f2b0 | comply — pattern confirmed in worker/internal/tts, material, render |
| rule-error-wrap | Go worker wraps every returned error with fmt.Errorf("op: %w", err) | rule-error-wrap#n42@v1:sha256:78e7958f4852af4bcb006076414be176c1cf66397765f62ae3f05034aa080d6a | comply — applies to worker/internal/** |
| rule-no-any-data | Go worker uses concrete job structs in types.go; TypeScript api uses typed VidgenEvent union | rule-no-any-data#n68@v1:sha256:5e7bc497997978068e9554409a4ec0fc59c8e2cf481cf0a04a1ee79223d18d95 | comply — no any/interface{} for data in either language |
| rule-tdd-table-tests | Go worker has table-driven tests; api uses bun:test with httptest-style fakes | rule-tdd-table-tests#n96@v1:sha256:277caf8c167663d816b6f19f3c45c6d78906e9703bfda010fc78fc5188c00df4 | comply — both apply to their respective packages |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| retire-facts | Retire c3-1, c3-2, c3-101..c3-115, c3-201, c3-210, ref-manifest-state | patches in .c3/changes/adr-20260709-webapp-topology/ |
| update-c3-0 | Update system Goal + Abstract Constraints to reflect webapp model | block patches on c3-0 |
| add-containers | Add c3-10 (api), c3-20 (worker), c3-30 (frontend) as children of c3-0 | whole patches |
| add-components | Add components under each new container | whole patches |
| update-refs | Update ref-idempotent-worker and ref-provider-seam How sections with real paths | block patches |
| add-ref | Add ref-event-contract (frozen cross-language event catalogue) | standalone c3 add after apply |

## Verification

| Check | Result |
| --- | --- |
| c3 list --flat shows no c3-1, c3-2, c3-101..c3-115, c3-201, c3-210, ref-manifest-state | verified after c3 change apply |
| c3 list --flat shows c3-10, c3-20, c3-30 with their component children | verified after c3 change apply |
| c3 check exits clean (no failed facts, excluding terminal ADRs) | c3 check |
| c3-0 Abstract Constraints no longer mention manifest or CLI | c3 read c3-0 --full |
