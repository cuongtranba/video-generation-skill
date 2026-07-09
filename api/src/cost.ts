import type { Scene, ProjectState } from './events.js'

/** Real FPT.AI TTS price per character, in USD. Mirrors
 * internal/cost/estimator.go's FPTAIPerChar — keep both in sync if the FPT
 * rate card changes. This is the ONLY enforced per-scene cost input; Agent
 * SDK notional cost never enters this calculation (index.md §6, BINDING). */
export const FPT_TTS_USD_PER_CHAR = 0.00001

export const DEFAULT_COST_CAP_USD = 0.15

export function costCapFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.COST_CAP_USD
  if (raw === undefined || raw === '') return DEFAULT_COST_CAP_USD
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COST_CAP_USD
}

export function projectedTtsUsd(scenes: Scene[]): number {
  const chars = scenes.reduce((sum, s) => sum + [...s.narration].length, 0)
  return chars * FPT_TTS_USD_PER_CHAR
}

export interface AdmitResult {
  admitted: boolean
  projectedUsd: number
  capUsd: number
}

/** Admissibility gate (spec §2.4 step 3 / §5.4): projects the total after
 * adding `additionalUsd` to what's already spent, and vetoes — dry-run, no
 * side effect — if that total would exceed the cap. */
export function admit(state: ProjectState, additionalUsd: number, capUsd: number): AdmitResult {
  const projectedUsd = state.spentUsd + additionalUsd
  return { admitted: projectedUsd <= capUsd, projectedUsd, capUsd }
}

export class CostCapExceededError extends Error {
  constructor(public readonly projectedUsd: number, public readonly capUsd: number) {
    super(`projected cost $${projectedUsd.toFixed(4)} exceeds cap $${capUsd.toFixed(2)}`)
    this.name = 'CostCapExceededError'
  }
}
