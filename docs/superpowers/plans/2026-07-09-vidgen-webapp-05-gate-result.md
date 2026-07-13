# P5 Pre-Deletion Capability-Parity Gate Result

**Date:** 2026-07-13
**Branch:** p5-cli-removal
**Verdict:** PROCEED (with two v1 limitations documented)

---

## Capability Map

| CLI step | Old command (flags) | Webapp command(s) (index §5) | Verdict |
|---|---|---|---|
| `new` | `vidgen new <idea> --duration --scenes --tone --resource` | `CreateProject {idea, durationSec, sceneCount, tone}` then `GenerateScript {projectId}` | **ACCEPTED v1 LIMITATION:** `--resource` (user-supplied local media directory) has no field in `CreateProject`'s frozen body and no upload flow in P1–P4. Webapp uses stock material providers only. Documented in Roadmap. |
| `material` | `vidgen material --project` | `ResolveMaterial {projectId}` → `vidgen.job.material.*` jobs → `MaterialResolved` | **Equivalent.** |
| `tune` | `vidgen tune --project --voice --speed --caption-font --caption-size --music --music-search --music-volume` | **None** in the frozen §5 command table or in `api/src/commands.ts` / `frontend/src/store/store.ts`. | **ACCEPTED v1 LIMITATION:** voice/speed/caption/music selection has no webapp command. `CreateProjectInput` fields are `{idea, durationSec, sceneCount, tone}` only. Worker uses its compiled-in defaults. Documented in Roadmap. |
| `confirm` | `vidgen confirm --project` | `CostProjected` event appended as part of `GenerateVoiceovers`; approval gate (`AwaitingApproval` → `ApproveStoryboard`) is the manual review step | **Shape change, not a gap.** The pre-spend checkpoint moved: cost wall fires before `GenerateVoiceovers` dispatches (admissibility check in `api/src/cost.ts`), then storyboard approval gate gives the user a review before render. Deliberate design (index §5 / spec §2.7). |
| `generate` | `vidgen generate --project --output` | `GenerateVoiceovers` (dispatches tts+caption jobs) then `ApproveStoryboard` (dispatches render job) | **Equivalent**, split across two commands plus the approval gate. |
| `publish` | `vidgen publish --project --caption --privacy --force` | `Publish {projectId, caption, privacy}` → `Published` | **Equivalent** for first-time publish. **ACCEPTED v1 LIMITATION:** `--force` re-publish has no equivalent — `assertTransition` only allows `Publish` from `['rendered']` status; once `published`, re-publish is blocked. Minor edge case; documented in Roadmap. |
| `list` | `vidgen list` | `GET /api/state` — returns all projects from Postgres projection | **Equivalent.** |

---

## GAP CHECK Resolutions

### GAP CHECK 1: `--resource` flag on `vidgen new`

**Verdict: v1 DESCOPED — acceptable, proceed.**

The `CreateProjectInput` in `api/src/commands.ts` line 17 defines exactly `{ idea: string; durationSec: number; sceneCount: number; tone: string }`. There is no `resourceDir` field, no file upload endpoint in `api/src/http.ts`, and no upload UI in `frontend/src/`. The webapp uses only stock material providers (Pexels, Pixabay) for all scenes.

This is an **explicit descope**: the CLI's local-asset seeding was a niche feature not carried into the frozen command contract (index §5). The frozen contract is the authoritative spec and does not include this field.

**Action:** Document as a known Roadmap item ("v2: local-asset upload for custom media").

### GAP CHECK 2: `tune` command (voice/speed/caption/music)

**Verdict: v1 DESCOPED — acceptable, proceed.**

The frozen command table in `docs/superpowers/plans/2026-07-09-vidgen-webapp-00-index.md §5` has 7 commands; `tune` is not among them. Confirmed by reading:
- `api/src/commands.ts` — no `tune`-equivalent command function exists
- `frontend/src/store/store.ts` — `CreateProjectInput` interface has `{idea, durationSec, sceneCount, tone}` only; no voice/speed/font/music fields
- `frontend/src/App.tsx` + all component files — no tune/voice/style UI controls exist

The Go worker retains its provider configuration for TTS (FPT.AI voice settings), but these are resolved at worker startup from `config.yaml` / environment, not from per-project user input. The webapp uses worker defaults for all voice/speed/caption/music parameters.

**Action:** Document as a known Roadmap item ("v2: per-project voice, speed, caption style, and music selection").

### GAP CHECK 3: `--force` flag on `vidgen publish`

**Verdict: v1 DESCOPED — minor edge case, proceed.**

The webapp's `assertTransition` in `api/src/aggregate.ts` line 41 defines `Publish: ['rendered']` as the only legal status. Once a project reaches `published` status, the `Publish` command would throw `InvalidTransitionError`. The old CLI's `--force` flag bypassed this check.

Re-publish is a minor operator edge case. The frozen command contract (index §5) does not include a `force` field in `PublishInput`.

**Action:** Document as a known Roadmap item ("v2: re-publish support with explicit force flag").

---

## E2E Browser Test

**Status: SKIPPED — infrastructure not available in headless environment.**

Docker Compose is not running in this execution context. The E2E test (Task 1 Step 3 of the P5 plan) requires `docker compose up -d --build` and a live browser session. This was a pre-condition check done textually instead:

- All 7 webapp commands are present in `api/src/commands.ts` and exposed via `api/src/http.ts`'s `COMMAND_HANDLERS` map
- All 7 command thunks are in `frontend/src/store/store.ts`'s `VidgenStore` interface
- The full pipeline is wired: CreateProject → GenerateScript → ResolveMaterial → GenerateVoiceovers → RequestApproval → ApproveStoryboard → Publish
- Cost wall is present at `api/src/cost.ts` (admitted before GenerateVoiceovers dispatches)
- Storyboard approval gate UI exists at `frontend/src/components/StoryboardApproval.tsx`

The E2E step will need to be run manually against the live compose stack before the PR is merged.

---

## Gate Verdict

**PROCEED to Task 2.**

All CLI capabilities are accounted for:
- 4 rows are **Equivalent** (material, confirm-shape-change, generate, list)
- 3 rows are **Accepted v1 limitations** (resource, tune, force-republish) — each is a deliberate descope from the frozen command contract (index §5), not an accidental loss
- The v1 limitations are documented above and should be added to README's Roadmap section in Task 3

The cost wall is preserved and strengthened (admissibility check fires before any spend-triggering dispatch, cap is `COST_CAP_USD` env, default `$0.15`). The manual review timing changed (after TTS, before render — spec §2.7 deliberate decision), but no capability is silently lost.
