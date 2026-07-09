import { describe, it, expect } from 'bun:test'
import type { Scene, ProjectState } from './events.js'
import { FPT_TTS_USD_PER_CHAR, DEFAULT_COST_CAP_USD, costCapFromEnv, projectedTtsUsd, admit } from './cost.js'

const emptyState: ProjectState = { projectId: 'p1', status: 'material', scenes: [], spentUsd: 0, approved: false }

describe('costCapFromEnv', () => {
  it('defaults to 0.15 when COST_CAP_USD is unset', () => {
    expect(costCapFromEnv({})).toBe(DEFAULT_COST_CAP_USD)
  })

  it('reads a valid COST_CAP_USD', () => {
    expect(costCapFromEnv({ COST_CAP_USD: '0.25' })).toBe(0.25)
  })

  it('falls back to the default on garbage input', () => {
    expect(costCapFromEnv({ COST_CAP_USD: 'not-a-number' })).toBe(DEFAULT_COST_CAP_USD)
  })
})

describe('projectedTtsUsd', () => {
  it('is chars × FPT_TTS_USD_PER_CHAR, counting Vietnamese diacritics as one char each', () => {
    const scenes: Scene[] = [{ idx: 0, narration: 'nước ấm', visual: 'v' }] // 7 chars
    expect(projectedTtsUsd(scenes)).toBeCloseTo(7 * FPT_TTS_USD_PER_CHAR)
  })

  it('is 0 for no scenes', () => {
    expect(projectedTtsUsd([])).toBe(0)
  })
})

describe('admit', () => {
  it('admits when projected spend is at or under the cap', () => {
    const result = admit(emptyState, 0.15, 0.15)
    expect(result.admitted).toBe(true)
    expect(result.projectedUsd).toBeCloseTo(0.15)
  })

  it('vetoes when projected spend exceeds the cap', () => {
    const result = admit(emptyState, 0.16, 0.15)
    expect(result.admitted).toBe(false)
  })

  it('adds to existing spend, not just the new amount', () => {
    const spent: ProjectState = { ...emptyState, spentUsd: 0.1 }
    const result = admit(spent, 0.1, 0.15)
    expect(result.admitted).toBe(false)
    expect(result.projectedUsd).toBeCloseTo(0.2)
  })
})
