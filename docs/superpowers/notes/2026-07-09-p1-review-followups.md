# P1 (api-core) — code-review follow-ups

Captured during the P1 code review (2026-07-09). P1 shipped green (62 tests, tsc
clean, full command flow verified end-to-end against live NATS + Postgres). The
items below were **deferred by decision** because they touch frozen contracts
(aggregate state machine, `foldProject`, the `Published` event shape) that P2–P5
build on; fixing them is a spec change best made when the components that actually
drive scene sequencing — P3 (Go worker) and P4 (SPA) — exist.

Two review criticals were **already fixed** before merge (commit `0ff64c0`):
`serveStatic` process-crash hardening, and codifying `VIDGEN_JOBS`
`duplicate_window`.

## Open follow-ups

### F1 — cost gate is skippable via the approval path (touches: aggregate, cost wall)
`aggregate.ts` makes both `GenerateVoiceovers` and `RequestApproval` legal from
status `'material'`, and `CostProjected` doesn't advance status in `foldProject`.
A client can therefore go `ResolveMaterial → RequestApproval → ApproveStoryboard`
and dispatch the render job without ever running `generateVoiceovers`, the only
place `admit()`/`CostCapExceededError` runs.
- **Severity nuance:** skipping voiceovers adds no TTS cost, so the real per-video
  total stays $0 and the $0.15 cap is not breached in dollars. This is a
  sequencing-completeness gap, not a cap-overrun — but it does mean render can be
  dispatched without the cost-projection step, which brushes the "never weaken the
  cost wall" rule.
- **Fix direction:** fold `CostProjected` (or `VoiceSynthesized`) into
  `ProjectStatus` so `RequestApproval` requires a post-voiceover status, OR add an
  explicit invariant in `requestApproval`/`assertTransition` that a
  `CostProjected`/`VoiceSynthesized` event exists. Revisit with P4 (the UI that
  drives this ordering).

### F3 — `Publish` field mapping (touches: `Published` event contract)
`commands.ts` `publish` writes `platform: input.privacy` and validates `caption`
(in `http.ts`) then discards it. The frozen `Published` shape is
`{ platform, postId, url }`. The plan explicitly flagged `publish` as a P1 stub
(real TikTok publish is a P3/worker concern), but the `platform ← privacy` mapping
is misleading and `caption` is dead input.
- **Fix direction (with P3):** map `platform` to the real destination
  (e.g. `'tiktok'`), decide whether `caption` belongs on the event / a job / is
  dropped from `PublishInput`.

### F4 — `MaterialResolved` advances status on the first scene, not all N
`events.ts` `foldProject` and `projections.ts` set status `'material'` on the
first `MaterialResolved`. With `sceneCount > 1`, downstream commands (gated on
`'material'`) become legal before every scene's material is resolved. Combined
with F1, the pipeline can reach `approved` with unresolved scenes.
- **Fix direction (with P3):** track resolved-scene count vs `sceneCount` in
  `ProjectState`; only transition to `'material'` when complete, or check scene
  completeness in `assertTransition`.

## Non-blocking minors (from the same review)
- Idempotency cache (`http.ts`) is unbounded — add TTL/LRU for long-running deploys.
- `readLedger` (`cost.ts`) is implemented + tested but not yet wired to a route.
- `serveStatic` traversal defense is correct but leans on `path.join` semantics —
  consider an explicit `startsWith(rootDir)` guard if refactored.
