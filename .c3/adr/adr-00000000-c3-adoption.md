---
id: adr-00000000-c3-adoption
c3-seal: dc28d194edf14f2417cfc7401f7d675462f4c08bfab26f636988f6cf23f2ab05
title: C3 Architecture Documentation Adoption
type: adr
goal: 'Adopt C3 as the frozen architecture-documentation model for the `vidgen` repository: capture the system, its two runtime containers, all fourteen components, and the conventions/standards that govern them as reviewed, frozen facts that change only through future change-units.'
status: done
affects:
    - c3-0
---

## Goal

Adopt C3 as the frozen architecture-documentation model for the `vidgen` repository: capture the system, its two runtime containers, all fourteen components, and the conventions/standards that govern them as reviewed, frozen facts that change only through future change-units.

## Context

`vidgen` is a Go CLI that turns a video idea into a finished 9:16 Vietnamese-voiced short through a long, multi-vendor, failure-prone pipeline (script → material → TTS → caption → render → publish), driven by a status machine over a JSON manifest and an embedded NATS JetStream bus with idempotent workers. Its architecture was described only in `README.md` and `CLAUDE.md` prose — accurate but unenforced, with no machine-checkable link between the design and the code. This ADR is the genesis change-unit that materializes that design as C3 facts. Affected topology: the whole system `c3-0` and everything beneath it.

## Decision

Model the topology top-down as authored in this unit's create-patches: one system (`c3-0`); two containers — the operator-facing CLI process (`c3-1`) and the in-process message-bus/async execution plane (`c3-2`); fourteen components mapping to the internal packages, with the four FFmpeg-adjacent synthesis packages grouped into `c3-113 audio-synthesis` (tts+music) and `c3-114 visual-assembly` (caption+render); three refs capturing tech-swappable conventions (provider seam, idempotent worker, manifest state); and five rules capturing enforceable standards (error-wrap, DI constructor, no-any data, the inviolable cost wall, table-driven TDD). Splitting the bus into its own container and grouping the synthesis packages were deliberate choices to reflect the real runtime boundary and keep the component count honest without losing file precision. Each fact carries an eval-spec binding it to its code, so conformance is re-checkable via `c3 eval`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | Genesis: the system fact and its goal/constraints are authored here | c3-0#n495@v2:sha256:28ceb5b0a9d0d851762f54fe43bfe05c9f3614812f33414bbb1a02be735b8ff6 | System constraints reviewed against README/CLAUDE.md |
| c3-1 | container | The CLI process and its 12 components (foundation + pipeline features) are created here | c3-1#n510@v2:sha256:f7e9a764be1726c70f8c102f5126e3244664a0143cac8c08e651f56975b9752d | Membership synthesized from child parent: links; refs/rules wired |
| c3-2 | container | The message-bus/async plane and its bus + worker components are created here | c3-2#n529@v2:sha256:65c1323806b606a8abcf119634fb2c766e5c867e3a08d7bb659af22b92234ba1 | Idempotency ref wired to worker; bus typed-message rule wired |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-seam | Governs config/videogen/material/audio-synthesis/publish — every vendor sits behind the config-driven factory seam | ref-provider-seam#n15@v1:sha256:cf44bdfa3d9f0204083c37f7955db1ff5582035c20f8a374487de348cd6c2515 | create-ref |
| ref-idempotent-worker | Governs worker/flow — re-runs must cost $0 via output-exists skip | ref-idempotent-worker#n24@v1:sha256:1d802d2e18bd54b6fc9dc4b0572e2ce10793149efe6306924b63200251372e32 | create-ref |
| ref-manifest-state | Governs domain/flow — resumable JSON manifest is the project's single source of truth | ref-manifest-state#n33@v1:sha256:21a3b8b5b025822ce0f8e03620a24e5cc7558aad41681a4d5aebfba08d488a36 | create-ref |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-error-wrap | Governs every component — errors wrapped with op context and %w | rule-error-wrap#n42@v1:sha256:78e7958f4852af4bcb006076414be176c1cf66397765f62ae3f05034aa080d6a | create-rule |
| rule-di-constructor | Governs constructor-injected components with compile-time interface checks | rule-di-constructor#n56@v1:sha256:7769dbc022335a59b7ab88e5b352b2be375d5b4f990ccaa7d70862cdf760f2b0 | create-rule |
| rule-no-any-data | Governs domain/config/bus/worker — concrete typed data, no any | rule-no-any-data#n68@v1:sha256:5e7bc497997978068e9554409a4ec0fc59c8e2cf481cf0a04a1ee79223d18d95 | create-rule |
| rule-cost-wall | Governs cost/flow/audio-synthesis — the inviolable $0.10 cap | rule-cost-wall#n82@v1:sha256:bddd6c55eb48a138d70b3f35fd8b3747a35aa4e9689abf0ad089d552d1ff0f75 | create-rule |
| rule-tdd-table-tests | Governs script/material/visual-assembly/worker — table-driven tests, faked externals | rule-tdd-table-tests#n96@v1:sha256:277caf8c167663d816b6f19f3c45c6d78906e9703bfda010fc78fc5188c00df4 | create-rule |

## Verification

| Check | Result |
| --- | --- |
| c3 check --fix | 0 issues; membership rows synthesized for c3-0, c3-1, c3-2 |
| c3 eval | all 22 specs (14 components + 3 refs + 5 rules) verdict: holds |
| c3 lookup 'internal/**' | every internal package file maps to its owning component fact |
| go vet ./... && go build ./... && go test ./... | vet clean, build success, 128 tests passed in 17 packages |
