# Pipeline rail — keyboard control

**Status:** approved (brainstorm) · **Branch:** `fix-board-clip` · **Date:** 2026-07-22

Closes impeccable-audit P1 "No keyboard affordances for a control-room tool"
(Nielsen H7 Flexibility & Efficiency scored 2/4). The power-operator persona
("Alex") drives many projects and wants to traverse stages and approve a ready
storyboard without leaving the keyboard.

Today each pipeline node is a `<button>` (Tab-focusable, Enter/Space selects) and
the detail-panel actions are keyboard-reachable, so the gap is **efficiency and
discoverability**, not raw capability.

## Behaviour

### Roving toolbar navigation (`PipelineCard` rail)
- Rail element gains `role="toolbar"`, `aria-label="Pipeline stages"`,
  `aria-orientation="horizontal"`.
- Roving tabindex: the selected node is `tabIndex=0`, all others `tabIndex=-1`
  (Tab lands on the rail once; arrows move within — the standard toolbar pattern,
  also a screen-reader win for the "Sam" persona).
- `ArrowRight` / `ArrowLeft`: move selection ±1, **clamped** (no wrap).
- `Home` / `End`: first / last node.
- Each move calls the existing `selectStep(projectId, key)` and moves DOM focus
  to that node's button.
- `Enter` / `Space`: select (unchanged — the button's existing `onClick`).

### Scoped action hotkeys
Handled on the rail's `onKeyDown`, so they fire **only while focus is inside this
card's rail** — never while typing in the create-project form (a different
subtree). Keyed off the currently-selected step:
- gate & state `awaiting`: `A` → `approveStoryboard`, `R` → `generateScript` (reject & rescript).
- state `failed`: `R` → retry (via `lastFailure` + `retryCommandFor` from `pipeline/derive`).
- any other state: letters are no-ops.

### Discoverability
Detail-panel buttons carry a visual key hint and the proper ARIA attribute:
`aria-keyshortcuts="A"` + a `<kbd aria-hidden>` cap. The hint is `aria-hidden`, so
the accessible name stays "Approve storyboard" (existing tests unaffected).

## Units
- `pipeline/hotkeys.ts` (new, pure): `stepHotkeys(step): {key, action}[]` and
  `hotkeyFor(step, pressed): action | undefined`. The single source of truth for
  "which key does what for this step", consumed by BOTH the rail handler and the
  button labels so they can't drift.
- `PipelineNode`: new `tabIndex` prop, forwarded to the `<button>`.
- `PipelineCard`: owns rail `role`, `ref`, `onKeyDown`, roving tabindex, and
  hotkey dispatch (pulls the four thunks + `lastFailure`/`retryCommandFor`).
- `StepDetail`: button key hints (`aria-keyshortcuts` + `<kbd>`).
- `app.css`: `.vg-kbd` cap — square, 1px ink, mono, matching the control-room system.

## Testing (TDD · testing-library + happy-dom, no backend)
- Arrow / Home / End move selection + move focus to the new node.
- Roving tabindex: selected node is the only `tabIndex=0`.
- `A` / `R` on an awaiting gate call the (store-mocked) approve / reject thunks.
- `R` on a failed node calls the retry thunk.
- `A` on a non-gate node is a no-op.
- Hotkeys don't fire from the create-project idea input (scope guard).

## Out of scope
Global shortcuts, bulk approve, and the persistent visible legend (the separate
P2 finding, not selected).
