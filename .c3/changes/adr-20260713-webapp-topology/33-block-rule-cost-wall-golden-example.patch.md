---
target: rule-cost-wall
scope: block
base: rule-cost-wall#n86@v1:sha256:0abb124d7d08035ec48404cba38d8a0ce3dc213b48d33b2a5d282b5bf5536947
---
## Golden Example

Literal from `api/src/cost.ts` — the admissibility gate:

```typescript
/** Admissibility gate (spec §2.4 step 3 / §5.4): projects the total after
 * adding `additionalUsd` to what's already spent, and vetoes — dry-run, no
 * side effect — if that total would exceed the cap. */
export function admit(state: ProjectState, additionalUsd: number, capUsd: number): AdmitResult { // REQUIRED
  const projectedUsd = state.spentUsd + additionalUsd
  return { admitted: projectedUsd <= capUsd, projectedUsd, capUsd } // REQUIRED: veto-before-dispatch, cap as constant
}
```
