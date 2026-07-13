---
target: rule-ui-state-in-store
scope: whole
type: rule
---
## Goal

All frontend state and side-effect logic must live in the single Zustand store, never in components, so the UI stays testable and the event-fold/command-dispatch logic has exactly one home.

## Rule

Components in `frontend/src/components/**` never call `useState`, `useReducer`, or a side-effecting `useEffect`; all state and logic live in the Zustand store (`frontend/src/store/store.ts`).

## Golden Example

Literal from `frontend/src/store/store.ts` — the store owns all state and command dispatch:

```typescript
// REQUIRED: all state in the store, not in components
export interface VidgenStore {
  projects: Record<string, ProjectState>
  connection: ConnectionState
  selectedId?: string
  applyEvent: (subject: string, event: VidgenEvent) => void
  createProject: (input: CreateProjectInput) => Promise<void>
  // ... all 7 command thunks here, not in components
  connect: () => Promise<void>
  disconnect: () => Promise<void>
}
```

Note: ESLint enforcement (no-restricted-syntax banning useState/useReducer in src/components/**) is a follow-up task — P4 did not implement the ESLint config. The rule's intent is established; the ESLint gate will be added in a follow-up patch once the config exists.

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
|---|---|---|
| `useState` inside a board component to track a modal's open/closed state | Store a `modalOpen` slice in the Zustand store, component reads/dispatches | Splits state between store and component; defeats the single-store contract |
| Component directly calling `fetch('/api/commands/createProject', ...)` | Use the `createProject` thunk from the store | Logic must live in the store, not scattered across components |

## Scope

Applies to `frontend/src/components/**`. Does not apply to `frontend/src/store/**` (the store itself) or `useRef` for DOM node references (explicitly allowed).
