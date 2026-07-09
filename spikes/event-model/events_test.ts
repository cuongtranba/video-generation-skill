import { describe, it, expect } from 'vitest'
import { foldProject, type VidgenEvent } from './events.js'

describe('foldProject', () => {
  it('folds a lifecycle into current state', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:01:00Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0.012 },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-09T00:02:00Z' },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: '2026-07-09T00:03:00Z' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at: '2026-07-09T00:04:00Z', outputPath: '/m/p1.mp4', renderUsd: 0.004 },
    ]
    const s = foldProject(events)
    expect(s.status).toBe('rendered')
    expect(s.spentUsd).toBeCloseTo(0.016)
    expect(s.approved).toBe(true)
    expect(s.outputPath).toBe('/m/p1.mp4')
  })
  it('reports awaiting_approval before approval', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't' },
    ])
    expect(s.status).toBe('awaiting_approval')
    expect(s.approved).toBe(false)
  })
})
