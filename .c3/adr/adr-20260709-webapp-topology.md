---
id: adr-20260709-webapp-topology
c3-seal: a15f7d5a26e337c7ee70ef13971de80a46f1e3d58db5c9f6340d44e836586eeb
title: webapp-topology
type: adr
goal: 'Replace the single-process CLI topology (one Go process holding all state) with a multi-service webapp topology: a TypeScript/Node API service, a Vite/React/Zustand frontend, a Go worker service, a NATS JetStream event store, and a Postgres read-model projection store. The CLI containers and all CLI-specific components are retired; media-pipeline components are reparented to the worker container; new API and frontend containers with their components are added.'
status: done
date: "2026-07-09"
---

## Goal

Replace the single-process CLI topology (one Go process holding all state) with a multi-service webapp topology: a TypeScript/Node API service, a Vite/React/Zustand frontend, a Go worker service, a NATS JetStream event store, and a Postgres read-model projection store. The CLI containers and all CLI-specific components are retired; media-pipeline components are reparented to the worker container; new API and frontend containers with their components are added.

## Context

The current architecture is a single Go CLI process (c3-1) that embeds NATS JetStream in-process, holds project state in a local JSON manifest, and orchestrates every pipeline step sequentially. This works for a single operator on a local machine but cannot support a browser-based multi-user flow. The P1-P4 phases introduced a TypeScript API (event-sourced with NATS), a React/Zustand frontend, a standalone Go worker service, and a Postgres projection store. The C3 canvas still reflects the old CLI topology: c3-1 (CLI), c3-2 (embedded bus), and CLI-specific components like flow, cli, videogen, publish, and cost. These must be retired and replaced with containers and components that describe the running webapp.

## Decision

Retire the CLI container c3-1 and its CLI-specific components (c3-104 cost, c3-105 videogen, c3-106 cli, c3-110 flow, c3-111 script, c3-115 publish) along with ref-manifest-state (manifest-on-disk no longer applies) and the embedded-bus component c3-201. Retitle c3-2 to "worker — Go media execution service". Reparent the media-pipeline components (c3-101 domain, c3-102 config, c3-103 prereq, c3-112 material, c3-113 audio-synthesis, c3-114 visual-assembly) to c3-2. Add four new containers under c3-0 (c3-3 api, c3-4 frontend, c3-5 nats, c3-6 postgres) with their components. Add rule-ui-state-in-store governing the Zustand state convention. Update c3-0 goal and abstract constraints to describe the webapp. Update rule-cost-wall golden example to reflect the TypeScript implementation in api/src/cost.ts.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Goal and Abstract Constraints describe a CLI pipeline; must be rewritten for the webapp | c3-0#n495@v2:sha256:28ceb5b0a9d0d851762f54fe43bfe05c9f3614812f33414bbb1a02be735b8ff6 "Turn a single video idea into a finished, publish-ready 9:16 Vietnamese-voiced short" | Update goal and constraints to name the new containers and webapp pattern |
| c3-1 | container | CLI process is no longer the runtime; replaced by api, worker, frontend, nats, postgres services | c3-1#n510@v2:sha256:f7e9a764be1726c70f8c102f5126e3244664a0143cac8c08e651f56975b9752d "Be the single operator-facing Go process" | Retire |
| c3-2 | container | Was embedded bus; is now the standalone Go worker service | c3-2#n529@v2:sha256:65c1323806b606a8abcf119634fb2c766e5c867e3a08d7bb659af22b92234ba1 "Be the asynchronous execution plane" | Retitle, rewrite goal and responsibilities |
| c3-101 | component | domain — reparent from c3-1 to c3-2 (worker owns domain types) | c3-101#n122@v1:sha256:7d5da60fbc08099d2766b03ea0f63b56ae419e0156da8cfd4f588d59b08c3dd7 "Define the project data model" | Reparent, update Parent Fit |
| c3-102 | component | config — reparent from c3-1 to c3-2 (worker config exists at worker/internal/config) | c3-102#n150@v1:sha256:48b2e9f64fbac5377d296fdf39ecd76234aa54dfa25e18ac0a6ec2a0d8c0fb70 "Select which vendor implements" | Reparent, update Parent Fit |
| c3-103 | component | prereq — reparent from c3-1 to c3-2 (binary resolution is worker responsibility) | c3-103#n177@v1:sha256:5c70b8c81aa3fde383322fcbb972ca51d9053d66748fc3a151a9325ecc07fae7 "Resolve and verify the external command-line binaries" | Reparent, update Parent Fit |
| c3-104 | component | cost — retire; cost enforcement is now in api/src/cost.ts (c3-303) | c3-104#n202@v1:sha256:4cf81a32a07c82191b279a177706329726ef6811f8b3d02dbd5e7eda718be504 "Project the USD cost of a video" | Retire |
| c3-105 | component | videogen — retire; AI clip-generation seam does not exist in the webapp | c3-105#n229@v1:sha256:36d4eb09f3412e11632d48b3c8a8509a816974da42b65c918ec47beca8508e93 "Provide a stable interface seam" | Retire |
| c3-106 | component | cli — retire; cobra CLI replaced by HTTP API and browser UI | c3-106#n254@v1:sha256:07dd6913fee04ab90b266552f5adf13c0fcda42197c85d96e24c4c50652cd6bb "Be the composition root: parse commands" | Retire |
| c3-110 | component | flow — retire; status machine is now the event-sourced aggregate in api | c3-110#n280@v1:sha256:961e3f2185026ac6611700e0a08d224c5078b2dc54979ae4dc9bba5f2cb345ab "Orchestrate the end-to-end project lifecycle" | Retire |
| c3-111 | component | script — retire; script generation is now c3-304 under api | c3-111#n308@v1:sha256:4ef998c26fac31c6e9843f9aab1877245fb26fcc98ec3fb7eff1dfece47c6fc4 "Turn a raw video idea into a structured" | Retire |
| c3-112 | component | material — reparent from c3-1 to c3-2 (worker executes material jobs) | c3-112#n334@v1:sha256:dbb19c32849057a0157d0c72fc739980eeda2f1bc971e7e9587de40bf9eac663 "Supply each scene with a visual" | Reparent, update Parent Fit |
| c3-113 | component | audio-synthesis — reparent from c3-1 to c3-2 | c3-113#n361@v1:sha256:b89f869abae2b25f94999ad0ca97782310f20b99ed343148376af7886bbfae39 "Produce the scene voiceover audio" | Reparent, update Parent Fit |
| c3-114 | component | visual-assembly — reparent from c3-1 to c3-2 | c3-114#n388@v1:sha256:ac77bf7d539fe2c4fa3e1e23ccba1d03e285b8dd164ab07a2402fb9c59a24bbf "Turn scene audio and visuals into the finished 9:16 MP4" | Reparent, update Parent Fit |
| c3-115 | component | publish — retire; publishing is out of scope for the worker; TikTok push is future work | c3-115#n414@v1:sha256:f052690f484a8ee36f899e528cb56306a533f05e2b672b702fe4a7fea2df2d9f "Upload the rendered 9:16 MP4" | Retire |
| c3-201 | component | bus — retire; NATS is now a standalone container (c3-5), not embedded | c3-201#n440@v1:sha256:0ec9ee3b8c33e7bebf9e2ccfe99f9ebb7f911b068be96b4bc547d403fb9e9332 "Provide the in-process, persistent message transport" | Retire |
| c3-210 | component | worker — keep under c3-2; update Purpose to reflect new parent role | c3-210#n467@v1:sha256:75ffcc1d691823c8d11e4d824cbcb741c3d25eec794028bb3459208457d94284 "Execute each generation job kind idempotently" | Update Purpose and Parent Fit |
| N.A - ref-manifest-state | N.A - ref | Manifest-on-disk pattern no longer applies; event store is the source of truth; all citers retired in this unit | ref-manifest-state#n33@v1:sha256:21a3b8b5b025822ce0f8e03620a24e5cc7558aad41681a4d5aebfba08d488a36 "Project state must survive process exit" | Retire |
| N.A - rule-cost-wall | N.A - rule | Golden Example must now cite api/src/cost.ts (TypeScript) not internal/cost/ledger.go | rule-cost-wall#n82@v1:sha256:bddd6c55eb48a138d70b3f35fd8b3747a35aa4e9689abf0ad089d552d1ff0f75 "A hard USD cap per video must be enforced" | Update Golden Example and Rule text |
| N.A - new c3-3 | N.A - new container under c3-0 | New api container: TypeScript/Node service hosting commands, aggregate, cost, script, projections | N.A - new entity | Add c3-3 under c3-0 |
| N.A - new c3-4 | N.A - new container under c3-0 | New frontend container: Vite/React/TS/Zustand SPA | N.A - new entity | Add c3-4 under c3-0 |
| N.A - new c3-5 | N.A - new container under c3-0 | New nats container: standalone NATS JetStream event store | N.A - new entity | Add c3-5 under c3-0 |
| N.A - new c3-6 | N.A - new container under c3-0 | New postgres container: Postgres read-model projections | N.A - new entity | Add c3-6 under c3-0 |
| N.A - new c3-301 | N.A - new component under c3-3 | aggregate — event-sourced project aggregate | N.A - new entity | Add c3-301 under c3-3 |
| N.A - new c3-302 | N.A - new component under c3-3 | commands-http — HTTP command surface | N.A - new entity | Add c3-302 under c3-3 |
| N.A - new c3-303 | N.A - new component under c3-3 | cost — cost wall enforcement in api | N.A - new entity | Add c3-303 under c3-3 |
| N.A - new c3-304 | N.A - new component under c3-3 | script — Agent SDK script generation | N.A - new entity | Add c3-304 under c3-3 |
| N.A - new c3-305 | N.A - new component under c3-3 | projections — Postgres read-model writers | N.A - new entity | Add c3-305 under c3-3 |
| N.A - new c3-401 | N.A - new component under c3-4 | store — Zustand store for all shared frontend state | N.A - new entity | Add c3-401 under c3-4 |
| N.A - new rule-ui-state-in-store | N.A - new rule | Enforces that all shared cross-component state lives in the Zustand store | N.A - new rule created by this ADR | Add rule-ui-state-in-store |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-idempotent-worker | Worker idempotency pattern still governs c3-210 and all media-pipeline consumers | ref-idempotent-worker#n24@v1:sha256:1d802d2e18bd54b6fc9dc4b0572e2ce10793149efe6306924b63200251372e32 "Re-running generation after a crash, partial failure, or JetStream redelivery" | comply — keep, no change needed |
| ref-provider-seam | Provider factory seam still governs material, audio-synthesis in worker | ref-provider-seam#n15@v1:sha256:cf44bdfa3d9f0204083c37f7955db1ff5582035c20f8a374487de348cd6c2515 "Every external vendor category" | comply — keep, no change needed |
| ref-manifest-state | No longer applicable — event store replaces manifest; all citers retired in this unit | ref-manifest-state#n33@v1:sha256:21a3b8b5b025822ce0f8e03620a24e5cc7558aad41681a4d5aebfba08d488a36 "Project state must survive process exit" | retire — all citers retired or reparented in this unit |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-cost-wall | Cost enforcement is now in api/src/cost.ts; golden example must reflect TypeScript | rule-cost-wall#n82@v1:sha256:bddd6c55eb48a138d70b3f35fd8b3747a35aa4e9689abf0ad089d552d1ff0f75 "A hard USD cap per video must be enforced" | update — new golden example from api/src/cost.ts |
| rule-di-constructor | Go DI pattern still applies to worker components | rule-di-constructor#n56@v1:sha256:7769dbc022335a59b7ab88e5b352b2be375d5b4f990ccaa7d70862cdf760f2b0 "Dependencies must be injected through constructors" | comply — keep, no change needed |
| rule-error-wrap | Go error wrapping still applies to worker components | rule-error-wrap#n42@v1:sha256:78e7958f4852af4bcb006076414be176c1cf66397765f62ae3f05034aa080d6a "Every error crossing a function boundary" | comply — keep, no change needed |
| rule-no-any-data | No-any rule applies across Go (worker) and TypeScript (api, frontend) | rule-no-any-data#n68@v1:sha256:5e7bc497997978068e9554409a4ec0fc59c8e2cf481cf0a04a1ee79223d18d95 "All domain and message data must be modeled" | comply — keep, no change needed |
| rule-tdd-table-tests | Table-driven test rule still applies to worker | rule-tdd-table-tests#n96@v1:sha256:277caf8c167663d816b6f19f3c45c6d78906e9703bfda010fc78fc5188c00df4 "Behavior across every package must be verified by table-driven tests" | comply — keep, no change needed |
| rule-ui-state-in-store | New rule: all shared frontend state must go in the Zustand store | N.A - new rule created by this ADR | create — add rule-ui-state-in-store |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| c3-0 system | Patch goal and abstract constraints to describe webapp topology | c3-0#n495@v2:sha256:28ceb5b0a9d0d851762f54fe43bfe05c9f3614812f33414bbb1a02be735b8ff6 "Turn a single video idea" |
| c3-1 retire | Retire CLI container | c3-1#n510@v2:sha256:f7e9a764be1726c70f8c102f5126e3244664a0143cac8c08e651f56975b9752d "Be the single operator-facing Go process" |
| c3-2 retitle | Retitle and rewrite goal and responsibilities for Go worker service | c3-2#n529@v2:sha256:65c1323806b606a8abcf119634fb2c766e5c867e3a08d7bb659af22b92234ba1 "Be the asynchronous execution plane" |
| CLI components retire | Retire c3-104, c3-105, c3-106, c3-110, c3-111, c3-115, c3-201 | .c3/ instance files |
| Media components reparent | Reparent c3-101, c3-102, c3-103, c3-112, c3-113, c3-114 to c3-2 | .c3/ instance files |
| New containers | Add c3-3 api, c3-4 frontend, c3-5 nats, c3-6 postgres | .c3/ instance files |
| New components | Add c3-301 through c3-305 under c3-3, c3-401 under c3-4 | .c3/ instance files |
| rule-cost-wall update | Update golden example to TypeScript from api/src/cost.ts | api/src/cost.ts |
| rule-ui-state-in-store | Add new rule with golden example from frontend/src/store/store.ts | frontend/src/store/store.ts |
| ref-manifest-state retire | Retire ref | .c3/ instance files |

## Verification

| Check | Result |
| --- | --- |
| C3X_MODE=agent bash /home/cuong/.claude/skills/c3/bin/c3x.sh list --flat | Shows c3-3, c3-4, c3-5, c3-6 as active containers; c3-1 retired; c3-2 retitled |
| C3X_MODE=agent bash /home/cuong/.claude/skills/c3/bin/c3x.sh read adr-20260709-webapp-topology | Status shows done |
| C3X_MODE=agent bash /home/cuong/.claude/skills/c3/bin/c3x.sh check | No errors reported |
| C3X_MODE=agent bash /home/cuong/.claude/skills/c3/bin/c3x.sh read c3-2 | Title is worker — Go media execution service |
| C3X_MODE=agent bash /home/cuong/.claude/skills/c3/bin/c3x.sh read rule-ui-state-in-store | New rule present and active |
