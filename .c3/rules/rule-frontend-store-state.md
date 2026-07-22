---
id: rule-frontend-store-state
c3-seal: 84850ecbf277b8e222fb72b69ca98a05e8460ebf67ff22fdf0fe6f3c2ddeb2b7
title: frontend-store-state
type: rule
goal: All frontend state shared across components (or derived from the event stream) must live in the Zustand store, never in component-local React `useState`. This keeps the SPA a pure projection of `VIDGEN_EVENTS` and makes state observable and testable outside React.
---

# Cross-component state lives in the Zustand store

## Goal

All frontend state shared across components (or derived from the event stream) must live in the Zustand store, never in component-local React `useState`. This keeps the SPA a pure projection of `VIDGEN_EVENTS` and makes state observable and testable outside React.

## Rule

Components under `frontend/src/components/` never call `useState` — they read via `useVidgenStore` selectors; form-local ephemeral state requires an explicit ast-grep ignore entry.

## Golden Example

```tsx
// frontend/src/components/Board.tsx
import { useVidgenStore } from '../store/store'          // REQUIRED: store import

export function Board() {
  const projects = useVidgenStore((state) => state.projects)  // REQUIRED: selector read
  const projectIds = Object.keys(projects)                    // OPTIONAL: local derivation
  ...
}
```

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| const [projects, setProjects] = useState({}) | useVidgenStore((s) => s.projects) | Duplicates event-folded state; drifts from the store on reconnect |
| Passing store data down through prop chains after copying into useState | Read the selector in the component that needs it | Copy goes stale; extra re-renders |

## Scope

`frontend/src/components/**`. Enforced by ast-grep rule `rules/no-react-usestate.yml` (CI job `ast-grep`). Form-local ephemeral state (e.g. `CreateProjectForm.tsx`, `TunePanel.tsx` upload/input fields) is exempted via the rule's `ignores` list.

## Override

Add the file to `ignores` in `rules/no-react-usestate.yml` in the same PR, with justification that the state is purely form-local and never read by another component.
